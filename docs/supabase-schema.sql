-- ============================================================================
-- Pronoia · esquema incremental para Supabase
--
-- Este archivo recoge SOLO las piezas que vamos agregando explícitamente.
-- Las tablas base (users, productos, bancas, movimientos, facturas,
-- factura_items) y las RPCs de auth (verify_login, create_user) ya existen
-- en Supabase y no están versionadas aquí todavía.
--
-- Cómo aplicar: pegar este script en Supabase Studio → SQL Editor → Run.
-- Es idempotente: usa CREATE IF NOT EXISTS / OR REPLACE.
-- ============================================================================


-- ============================================================================
-- Bloque 1 · tasas_cambio
-- Histórico de tasas de cambio. Lo usa el backend Express
-- (GET /api/tasas/oficial) para cachear la tasa BCV por 24 h.
-- ============================================================================

create table if not exists public.tasas_cambio (
  id            uuid        primary key default gen_random_uuid(),
  moneda_origen text        not null,
  moneda_destino text       not null,
  tasa          numeric(20, 6) not null check (tasa > 0),
  fuente        text        not null default 'BCV',
  fecha         timestamptz not null default now()
);

create index if not exists idx_tasas_cambio_fecha
  on public.tasas_cambio (moneda_origen, moneda_destino, fecha desc);


-- ============================================================================
-- Bloque 2 · trigger de saldo en bancas
-- Cuando se inserta un movimiento, ajusta automáticamente bancas.saldo.
-- Regla de dominio (CLAUDE.md): los saldos NUNCA se editan a mano,
-- se derivan de movimientos.
--
-- Reglas por tipo:
--   ingreso        → banca_origen_id  +=  monto
--   egreso         → banca_origen_id  -=  monto
--   transferencia  → banca_origen_id  -=  monto
--                    banca_destino_id +=  monto
--
-- Nota fase B: la transferencia entre monedas distintas (Bs↔USD)
-- requerirá conversión vía tasa de cambio. De momento asume misma moneda.
-- ============================================================================

create or replace function public.aplicar_movimiento_a_saldo()
returns trigger
language plpgsql
as $$
begin
  if new.tipo = 'ingreso' then
    update public.bancas
       set saldo = saldo + new.monto
     where id = new.banca_origen_id;

  elsif new.tipo = 'egreso' then
    update public.bancas
       set saldo = saldo - new.monto
     where id = new.banca_origen_id;

  elsif new.tipo = 'transferencia' then
    update public.bancas
       set saldo = saldo - new.monto
     where id = new.banca_origen_id;

    update public.bancas
       set saldo = saldo + new.monto
     where id = new.banca_destino_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_aplicar_movimiento on public.movimientos;

create trigger trg_aplicar_movimiento
after insert on public.movimientos
for each row
execute function public.aplicar_movimiento_a_saldo();


-- ============================================================================
-- Bloque 3 · función de reconciliación (opcional pero útil)
-- Recalcula desde cero el saldo de una banca a partir del histórico.
-- Úsala si los saldos quedan desincronizados (drift) o tras correcciones.
--
-- Ejemplo:  select public.reconciliar_saldo_banca('uuid-de-la-banca');
-- ============================================================================

create or replace function public.reconciliar_saldo_banca(p_banca_id uuid)
returns numeric
language plpgsql
as $$
declare
  v_saldo numeric := 0;
begin
  select coalesce(sum(case
           when tipo = 'ingreso'       and banca_origen_id  = p_banca_id then  monto
           when tipo = 'egreso'        and banca_origen_id  = p_banca_id then -monto
           when tipo = 'transferencia' and banca_origen_id  = p_banca_id then -monto
           when tipo = 'transferencia' and banca_destino_id = p_banca_id then  monto
           else 0
         end), 0)
    into v_saldo
    from public.movimientos;

  update public.bancas set saldo = v_saldo where id = p_banca_id;
  return v_saldo;
end;
$$;


-- ============================================================================
-- Bloque 4 · RLS abierto en bancas/movimientos + tipo de banca
--
-- Contexto: el frontend usa la anon key (auth custom no integrado con Supabase
-- Auth), así que RLS basado en auth.uid() no aplica. Para que el frontend pueda
-- leer/escribir, se deshabilita RLS en estas tablas (consistente con productos
-- y users, que tienen RLS off o policy abierta).
--
-- Deuda técnica: cualquier app con la anon key puede leer/escribir estas tablas.
-- Para cerrarlo bien, hay que routear todo por backend Express (service_role)
-- o migrar auth a Supabase Auth.
-- ============================================================================

alter table public.bancas      disable row level security;
alter table public.movimientos disable row level security;

-- Tipo de banca (clasifica para iconos/agrupación en UI)
alter table public.bancas
  add column if not exists tipo text not null default 'banco_nacional';

alter table public.bancas drop constraint if exists bancas_tipo_check;
alter table public.bancas
  add constraint bancas_tipo_check
  check (tipo in ('banco_nacional', 'banco_internacional', 'exchange', 'efectivo'));


-- ============================================================================
-- Bloque 5 · soft delete de bancas (regla de dominio: en finanzas no se borra)
--
-- Las bancas con saldo 0 se "archivan" en lugar de borrarse físicamente.
-- Esto preserva la integridad referencial con movimientos históricos y
-- cumple la regla del CLAUDE.md de no borrar registros financieros.
--
-- Para des-archivar una banca: update bancas set archivada = false where id = '...';
-- ============================================================================

alter table public.bancas
  add column if not exists archivada boolean not null default false;

alter table public.bancas
  add column if not exists archivada_en timestamptz;

create index if not exists idx_bancas_activas
  on public.bancas (archivada)
  where archivada = false;


-- ============================================================================
-- Bloque 6 · clientes frecuentes
--
-- Aunque la empresa es principalmente compradora, también factura a clientes
-- recurrentes (módulo de facturación). Esta tabla evita re-tipear datos en
-- cada factura.
--
-- RLS deshabilitado por consistencia con productos/users (todo va por backend
-- Express con service_role). Misma deuda técnica documentada en el bloque 4.
-- ============================================================================

create table if not exists public.clientes (
  id              uuid        primary key default gen_random_uuid(),
  nombre          text        not null,
  identificacion  text,
  email           text,
  telefono        text,
  direccion       text,
  notas           text,
  activo          boolean     not null default true,
  creado_por      uuid        references public.users(id) on delete set null,
  creado_en       timestamptz not null default now()
);

alter table public.clientes disable row level security;

create index if not exists idx_clientes_activos
  on public.clientes (activo, creado_en desc);

-- Búsqueda rápida por nombre (útil para el selector de cliente en facturas).
create index if not exists idx_clientes_nombre_lower
  on public.clientes (lower(nombre));


-- ============================================================================
-- Bloque 7 · módulo de materiales, pesaje y facturación compra/venta
--
-- Amplía el modelo para el flujo de scrap/pesaje:
--   tipos_material              → clasificación de materiales (catálogo)
--   productos.tipo_material_id  → enlaza un producto con su tipo de material
--   listas_precios              → precio por producto con histórico (vigente_desde)
--   proveedores                 → de quién se compra
--   tickets_pesaje              → pesada física (bruto/tara/devolución → neto calculado)
--   facturas_compra             → factura contra proveedor (desde ticket o peso manual)
--   facturas_venta              → idéntica forma, pero contra cliente
--   transformaciones (+detalle) → un material entra y salen uno o varios
--
-- RLS: DESHABILITADO, consistente con el resto del proyecto. La auth es por JWT
-- propio (no Supabase Auth), así que auth.uid() es NULL desde el front y una
-- policy basada en él bloquearía todo. Estas tablas se cerrarán en la migración
-- global de RLS (ver Bloque 4 y docs/rls-plan.md) cuando las escrituras pasen
-- por el backend con service_role.
--
-- Nota: los nombres de columna respetan el spec recibido (created_at en inglés),
-- aunque clientes/users usan creado_en. Si se quiere homogenizar a futuro, es un
-- rename aparte para no mezclar con esta migración.
-- ============================================================================


-- ---- tipos_material --------------------------------------------------------
create table if not exists public.tipos_material (
  id          uuid        primary key default gen_random_uuid(),
  nombre      text        not null,
  descripcion text,
  activo      boolean     not null default true,
  created_at  timestamptz not null default now()
);

alter table public.tipos_material disable row level security;

create index if not exists idx_tipos_material_activos
  on public.tipos_material (activo, nombre);


-- ---- productos.tipo_material_id (verificar + agregar si falta) --------------
-- 'if not exists' hace de verificación idempotente: no falla si ya existe.
alter table public.productos
  add column if not exists tipo_material_id uuid references public.tipos_material(id);

create index if not exists idx_productos_tipo_material
  on public.productos (tipo_material_id);


-- ---- listas_precios (cabecera) + precios_lista (detalle) -------------------
-- Una lista ("Precios Junio") agrupa los precios que se le pagan a proveedores
-- por kg de cada material. La CABECERA tiene nombre/vigencia; el DETALLE es una
-- fila (material, precio) por cada material de la lista.
--
-- Al facturar una compra, se elige una lista (facturas_compra.lista_precios_id
-- → listas_precios.id) y el sistema jala el precio del material desde
-- precios_lista. Puede haber varias listas activas a la vez (por proveedor,
-- por semana, etc.).
create table if not exists public.listas_precios (
  id            uuid        primary key default gen_random_uuid(),
  nombre        text        not null,
  vigente_desde date,
  activo        boolean     not null default true,
  created_at    timestamptz not null default now()
);

alter table public.listas_precios disable row level security;

create index if not exists idx_listas_precios_activas
  on public.listas_precios (activo, nombre);

create table if not exists public.precios_lista (
  id          uuid           primary key default gen_random_uuid(),
  lista_id    uuid           not null references public.listas_precios(id) on delete cascade,
  producto_id uuid           not null references public.productos(id),
  precio      numeric(10, 2) not null,
  created_at  timestamptz    not null default now(),
  -- un material aparece una sola vez por lista (target del upsert).
  unique (lista_id, producto_id)
);

alter table public.precios_lista disable row level security;

create index if not exists idx_precios_lista_lista
  on public.precios_lista (lista_id);

-- Para el selector: listas que tienen precio de un material dado.
create index if not exists idx_precios_lista_producto
  on public.precios_lista (producto_id);


-- ---- proveedores -----------------------------------------------------------
create table if not exists public.proveedores (
  id         uuid        primary key default gen_random_uuid(),
  nombre     text        not null,
  rfc        text,
  telefono   text,
  email      text,
  activo     boolean     not null default true,
  created_at timestamptz not null default now()
);

alter table public.proveedores disable row level security;

create index if not exists idx_proveedores_activos
  on public.proveedores (activo, created_at desc);

create index if not exists idx_proveedores_nombre_lower
  on public.proveedores (lower(nombre));


-- ---- tickets_pesaje --------------------------------------------------------
-- entidad_id es una FK polimórfica (proveedor si tipo='compra', cliente si
-- tipo='venta'). Sin FK real porque apunta a dos tablas distintas; la
-- integridad se valida en backend.
-- peso_neto es una columna GENERADA: bruto - tara - devolución (coalesce para
-- que un NULL en devolución no anule el cálculo).
create table if not exists public.tickets_pesaje (
  id            uuid        primary key default gen_random_uuid(),
  tipo          text        check (tipo in ('compra', 'venta')),
  entidad_id    uuid,
  fecha         date,
  subcategoria  text,
  peso_bruto    numeric,
  tara          numeric,
  devolucion    numeric     not null default 0,
  peso_neto     numeric     generated always as (peso_bruto - tara - coalesce(devolucion, 0)) stored,
  fotos         text[],
  observaciones text,
  facturado     boolean     not null default false,
  created_at    timestamptz not null default now()
);

alter table public.tickets_pesaje disable row level security;

create index if not exists idx_tickets_pesaje_tipo_fecha
  on public.tickets_pesaje (tipo, fecha desc);

create index if not exists idx_tickets_pesaje_entidad
  on public.tickets_pesaje (entidad_id);

-- Para listar pendientes de facturar.
create index if not exists idx_tickets_pesaje_pendientes
  on public.tickets_pesaje (facturado)
  where facturado = false;


-- ---- facturas_compra -------------------------------------------------------
create table if not exists public.facturas_compra (
  id               uuid        primary key default gen_random_uuid(),
  proveedor_id     uuid        references public.proveedores(id),
  ticket_id        uuid        references public.tickets_pesaje(id),
  peso_manual      numeric,
  lista_precios_id uuid        references public.listas_precios(id),
  precio_unitario  numeric     not null,
  total            numeric     not null,
  descripcion      text,
  observaciones    text,
  estado           text        not null default 'emitida'
                               check (estado in ('borrador', 'emitida', 'pagada')),
  created_at       timestamptz not null default now()
);

alter table public.facturas_compra disable row level security;

create index if not exists idx_facturas_compra_proveedor
  on public.facturas_compra (proveedor_id, created_at desc);

create index if not exists idx_facturas_compra_estado
  on public.facturas_compra (estado);


-- ---- facturas_venta --------------------------------------------------------
-- Misma forma que facturas_compra pero contra un cliente.
create table if not exists public.facturas_venta (
  id               uuid        primary key default gen_random_uuid(),
  cliente_id       uuid        references public.clientes(id),
  ticket_id        uuid        references public.tickets_pesaje(id),
  peso_manual      numeric,
  lista_precios_id uuid        references public.listas_precios(id),
  precio_unitario  numeric     not null,
  total            numeric     not null,
  descripcion      text,
  observaciones    text,
  estado           text        not null default 'emitida'
                               check (estado in ('borrador', 'emitida', 'pagada')),
  created_at       timestamptz not null default now()
);

alter table public.facturas_venta disable row level security;

create index if not exists idx_facturas_venta_cliente
  on public.facturas_venta (cliente_id, created_at desc);

create index if not exists idx_facturas_venta_estado
  on public.facturas_venta (estado);


-- ---- transformaciones + detalle --------------------------------------------
-- Un material de entrada se transforma en uno o varios materiales de salida.
-- material_entrada_id y material_salida_id apuntan a productos (el catálogo
-- de materiales).
create table if not exists public.transformaciones (
  id                  uuid        primary key default gen_random_uuid(),
  fecha               date,
  material_entrada_id uuid        references public.productos(id),
  cantidad_entrada    numeric     not null,
  notas               text,
  created_at          timestamptz not null default now()
);

alter table public.transformaciones disable row level security;

create index if not exists idx_transformaciones_fecha
  on public.transformaciones (fecha desc);

create table if not exists public.detalle_transformaciones (
  id                 uuid    primary key default gen_random_uuid(),
  transformacion_id  uuid    references public.transformaciones(id) on delete cascade,
  material_salida_id uuid    references public.productos(id),
  cantidad           numeric not null
);

alter table public.detalle_transformaciones disable row level security;

create index if not exists idx_detalle_transformaciones_transformacion
  on public.detalle_transformaciones (transformacion_id);


-- ============================================================================
-- Bloque 8 · categorías de material = tipos_material (reemplaza productos.categoria)
--
-- El texto libre productos.categoria se sustituye por tipo_material_id (FK a
-- tipos_material) para poder agrupar el inventario por categoría de forma
-- fiable (PCB, No Ferroso, Basura Buena, Merma, etc.). La tabla tipos_material
-- y la columna productos.tipo_material_id ya existen (Bloque 7).
--
-- Idempotente: se puede correr varias veces sin duplicar.
-- ============================================================================

-- Evita categorías duplicadas por mayúsculas/espacios ("PCB" vs "pcb").
create unique index if not exists ux_tipos_material_nombre
  on public.tipos_material (lower(nombre));

-- 1) Sembrar categorías a partir de los textos libres existentes en productos.
insert into public.tipos_material (nombre)
select distinct trim(p.categoria)
from public.productos p
where p.categoria is not null
  and trim(p.categoria) <> ''
  and not exists (
    select 1 from public.tipos_material t
    where lower(t.nombre) = lower(trim(p.categoria))
  );

-- 2) Backfill: enlazar cada producto con su categoría recién creada.
update public.productos p
set tipo_material_id = t.id
from public.tipos_material t
where p.tipo_material_id is null
  and p.categoria is not null
  and lower(t.nombre) = lower(trim(p.categoria));

-- 3) categoria deja de ser obligatoria (la app ya no la escribe). Se conserva
--    la columna por compatibilidad; cuando verifiques que todo quedó migrado
--    puedes eliminarla con:  alter table public.productos drop column categoria;
alter table public.productos alter column categoria drop not null;


-- ============================================================================
-- Bloque 9 · enlazar movimientos de tesorería con proveedores/clientes
--
-- Un pago a un proveedor (o un cobro de un cliente) es un movimiento real de
-- una banca (egreso/ingreso). Estas columnas permiten atribuir el movimiento a
-- la entidad para armar su estado de cuenta. Son nullable: la mayoría de
-- movimientos (transferencias internas, gastos varios) no van atados a nadie.
--
-- Convención del estado de cuenta:
--   proveedor → factura_compra = cargo (lo que le debemos)
--               movimiento egreso con proveedor_id = abono (pago/adelanto)
--   cliente   → factura_venta = cargo (lo que nos debe)
--               movimiento ingreso con cliente_id = abono (cobro)
--   Los DESCUENTOS (no mueven plata) quedan pendientes de modelar aparte.
-- ============================================================================

alter table public.movimientos
  add column if not exists proveedor_id uuid references public.proveedores(id);
alter table public.movimientos
  add column if not exists cliente_id uuid references public.clientes(id);

create index if not exists idx_movimientos_proveedor on public.movimientos (proveedor_id);
create index if not exists idx_movimientos_cliente   on public.movimientos (cliente_id);


-- ============================================================================
-- Bloque 10 · material pesado en el ticket de pesaje
--
-- El ticket apunta al producto/material que se está pesando (mismo catálogo que
-- usan las facturas y las listas de precios), para que el flujo
-- pesaje → factura → precio sea consistente.
-- ============================================================================

alter table public.tickets_pesaje
  add column if not exists producto_id uuid references public.productos(id);

create index if not exists idx_tickets_pesaje_producto
  on public.tickets_pesaje (producto_id);


-- ============================================================================
-- Bloque 11 · material en las facturas de compra/venta
--
-- La factura registra qué material se compró/vendió (mismo catálogo de
-- productos). Permite jalar el precio de la lista, calcular el total y filtrar
-- el historial por material.
-- ============================================================================

alter table public.facturas_compra
  add column if not exists producto_id uuid references public.productos(id);
alter table public.facturas_venta
  add column if not exists producto_id uuid references public.productos(id);

create index if not exists idx_facturas_compra_producto on public.facturas_compra (producto_id);
create index if not exists idx_facturas_venta_producto  on public.facturas_venta (producto_id);


-- ============================================================================
-- Bloque 12 · RPC atómica para registrar transformaciones
--
-- Inserta la cabecera (transformaciones) y todas las líneas de salida
-- (detalle_transformaciones) en UNA sola transacción: una función plpgsql corre
-- atómicamente, así que si algo falla no queda el inventario a medias.
--
-- El inventario es calculado (Bloque 9/inventario-service), por lo que al
-- insertar la transformación el material de entrada se descuenta y los de
-- salida se suman automáticamente. La validación de stock disponible la hace
-- el backend antes de llamar a esta función.
--
-- p_detalles: jsonb array → [{ "material_salida_id": uuid, "cantidad": numeric }, ...]
-- ============================================================================

create or replace function public.crear_transformacion(
  p_material_entrada_id uuid,
  p_cantidad_entrada    numeric,
  p_notas               text,
  p_fecha               date,
  p_detalles            jsonb
) returns uuid
language plpgsql
as $$
declare
  v_id   uuid;
  v_item jsonb;
begin
  insert into public.transformaciones (material_entrada_id, cantidad_entrada, notas, fecha)
  values (p_material_entrada_id, p_cantidad_entrada, nullif(p_notas, ''), coalesce(p_fecha, current_date))
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(p_detalles) as elems(value)
  loop
    insert into public.detalle_transformaciones (transformacion_id, material_salida_id, cantidad)
    values (v_id, (v_item->>'material_salida_id')::uuid, (v_item->>'cantidad')::numeric);
  end loop;

  return v_id;
end;
$$;


-- ============================================================================
-- Bloque 13 · política de Storage para el bucket 'tickets'
--
-- El bucket 'tickets' (fotos de pesaje) existe y es público (lectura), pero sin
-- política de escritura la anon key no puede subir
-- ("new row violates row-level security policy"). Esto le da el mismo acceso
-- abierto que ya tiene el bucket 'productos' (misma deuda RLS documentada: hoy
-- todo va por la anon key). Correr en el SQL Editor de Supabase.
-- ============================================================================

drop policy if exists "tickets acceso anon" on storage.objects;
create policy "tickets acceso anon"
  on storage.objects for all
  to anon, authenticated
  using (bucket_id = 'tickets')
  with check (bucket_id = 'tickets');


-- ============================================================================
-- Bloque 14 · correlativo automático de tickets de pesaje
--
-- Cada ticket recibe un número de control secuencial (1, 2, 3, ...) que la app
-- muestra como "Pesaje 0001". Lo asigna la BD vía una secuencia; el usuario no
-- lo escribe. Se respalda en una secuencia (no en max()+1) para que dos inserts
-- concurrentes no choquen.
-- ============================================================================

create sequence if not exists public.tickets_pesaje_numero_seq;

alter table public.tickets_pesaje
  add column if not exists numero bigint;

-- Backfill: numera los tickets existentes en orden de creación.
update public.tickets_pesaje t
set numero = o.rn
from (
  select id, row_number() over (order by created_at, id) as rn
  from public.tickets_pesaje
  where numero is null
) o
where t.id = o.id;

-- Avanza la secuencia más allá del máximo ya asignado.
select setval(
  'public.tickets_pesaje_numero_seq',
  coalesce((select max(numero) from public.tickets_pesaje), 0) + 1,
  false
);

-- Nuevas filas toman el siguiente valor de la secuencia automáticamente.
alter table public.tickets_pesaje
  alter column numero set default nextval('public.tickets_pesaje_numero_seq');

alter table public.tickets_pesaje
  alter column numero set not null;

-- Garantiza unicidad del correlativo.
create unique index if not exists idx_tickets_pesaje_numero
  on public.tickets_pesaje (numero);


-- ============================================================================
-- Bloque 15 · correlativo automático de facturas de compra
--
-- Cada factura de compra recibe un número de control secuencial (1, 2, 3, ...)
-- que la app muestra como "Compra 0001". Lo asigna la BD vía una secuencia; el
-- usuario no lo escribe. Mismo patrón que el Bloque 14 (tickets de pesaje).
-- Solo aplica a facturas_compra (las de venta no lo llevan por ahora).
-- ============================================================================

create sequence if not exists public.facturas_compra_numero_seq;

alter table public.facturas_compra
  add column if not exists numero bigint;

-- Backfill: numera las facturas existentes en orden de creación.
update public.facturas_compra f
set numero = o.rn
from (
  select id, row_number() over (order by created_at, id) as rn
  from public.facturas_compra
  where numero is null
) o
where f.id = o.id;

-- Avanza la secuencia más allá del máximo ya asignado.
select setval(
  'public.facturas_compra_numero_seq',
  coalesce((select max(numero) from public.facturas_compra), 0) + 1,
  false
);

-- Nuevas filas toman el siguiente valor de la secuencia automáticamente.
alter table public.facturas_compra
  alter column numero set default nextval('public.facturas_compra_numero_seq');

alter table public.facturas_compra
  alter column numero set not null;

-- Garantiza unicidad del correlativo.
create unique index if not exists idx_facturas_compra_numero
  on public.facturas_compra (numero);


-- ============================================================================
-- Bloque 16 · ticket de pesaje con múltiples materiales
--
-- Un ticket pasa de registrar UN material a N materiales. Cada material es una
-- fila en detalle_tickets_pesaje, con su propio peso. El header (tickets_pesaje)
-- conserva tipo/entidad/fecha/fotos/observaciones/facturado/numero. Las columnas
-- por-material del header (producto_id, subcategoria, peso_bruto, tara,
-- devolucion, peso_neto) quedan como LEGACY: ya no se escriben para tickets
-- nuevos, pero se conservan para no perder el dato histórico ni romper la
-- columna generada. peso_neto de cada línea se calcula igual que antes.
-- ============================================================================

create table if not exists public.detalle_tickets_pesaje (
  id            uuid        primary key default gen_random_uuid(),
  ticket_id     uuid        not null references public.tickets_pesaje(id) on delete cascade,
  producto_id   uuid        references public.productos(id),
  subcategoria  text,
  peso_bruto    numeric,
  tara          numeric,
  devolucion    numeric     not null default 0,
  peso_neto     numeric     generated always as (peso_bruto - tara - coalesce(devolucion, 0)) stored,
  created_at    timestamptz not null default now()
);

alter table public.detalle_tickets_pesaje disable row level security;

create index if not exists idx_detalle_tickets_pesaje_ticket
  on public.detalle_tickets_pesaje (ticket_id);

-- Backfill: cada ticket existente genera una línea de material (1:1).
insert into public.detalle_tickets_pesaje (ticket_id, producto_id, subcategoria, peso_bruto, tara, devolucion)
select t.id, t.producto_id, t.subcategoria, t.peso_bruto, t.tara, coalesce(t.devolucion, 0)
from public.tickets_pesaje t
where not exists (
  select 1 from public.detalle_tickets_pesaje d where d.ticket_id = t.id
);

-- RPC atómica: inserta el header (numero vía default) + N líneas de material.
-- Mismo patrón que crear_transformacion (Bloque 12).
-- p_materiales: jsonb array → [{ "producto_id": uuid, "subcategoria": text,
--   "peso_bruto": numeric, "tara": numeric, "devolucion": numeric }, ...]
create or replace function public.crear_ticket_pesaje(
  p_tipo          text,
  p_entidad_id    uuid,
  p_fecha         date,
  p_fotos         text[],
  p_observaciones text,
  p_materiales    jsonb
) returns uuid
language plpgsql
as $$
declare
  v_id   uuid;
  v_item jsonb;
begin
  insert into public.tickets_pesaje (tipo, entidad_id, fecha, fotos, observaciones)
  values (p_tipo, p_entidad_id, p_fecha, p_fotos, nullif(p_observaciones, ''))
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(p_materiales) as elems(value)
  loop
    insert into public.detalle_tickets_pesaje
      (ticket_id, producto_id, subcategoria, peso_bruto, tara, devolucion)
    values (
      v_id,
      (v_item->>'producto_id')::uuid,
      nullif(v_item->>'subcategoria', ''),
      (v_item->>'peso_bruto')::numeric,
      (v_item->>'tara')::numeric,
      coalesce((v_item->>'devolucion')::numeric, 0)
    );
  end loop;

  return v_id;
end;
$$;


-- ============================================================================
-- Bloque 17 · facturas de compra/venta con múltiples líneas
--
-- Una factura pasa de UNA línea (un material, un peso, un precio) a N líneas.
-- Cada línea vive en detalle_facturas_compra / detalle_facturas_venta, con su
-- material, peso, precio unitario y subtotal (= peso · precio, generado). El
-- header conserva entidad/ticket/estado/numero y `total` (ahora = suma de
-- subtotales). Las columnas single del header (producto_id, peso_manual,
-- precio_unitario) quedan LEGACY (precio_unitario sigue NOT NULL → se guarda 0).
-- ============================================================================

create table if not exists public.detalle_facturas_compra (
  id              uuid        primary key default gen_random_uuid(),
  factura_id      uuid        not null references public.facturas_compra(id) on delete cascade,
  producto_id     uuid        references public.productos(id),
  peso            numeric     not null,
  precio_unitario numeric     not null,
  subtotal        numeric     generated always as (peso * precio_unitario) stored,
  created_at      timestamptz not null default now()
);

create table if not exists public.detalle_facturas_venta (
  id              uuid        primary key default gen_random_uuid(),
  factura_id      uuid        not null references public.facturas_venta(id) on delete cascade,
  producto_id     uuid        references public.productos(id),
  peso            numeric     not null,
  precio_unitario numeric     not null,
  subtotal        numeric     generated always as (peso * precio_unitario) stored,
  created_at      timestamptz not null default now()
);

alter table public.detalle_facturas_compra disable row level security;
alter table public.detalle_facturas_venta  disable row level security;

create index if not exists idx_detalle_facturas_compra_factura
  on public.detalle_facturas_compra (factura_id);
create index if not exists idx_detalle_facturas_venta_factura
  on public.detalle_facturas_venta (factura_id);

-- Backfill: cada factura existente genera una línea (1:1). El peso sale del
-- peso_manual o, si la factura venía de un ticket, del peso_neto del ticket.
insert into public.detalle_facturas_compra (factura_id, producto_id, peso, precio_unitario)
select f.id, f.producto_id, coalesce(f.peso_manual, t.peso_neto, 0), f.precio_unitario
from public.facturas_compra f
left join public.tickets_pesaje t on t.id = f.ticket_id
where not exists (select 1 from public.detalle_facturas_compra d where d.factura_id = f.id);

insert into public.detalle_facturas_venta (factura_id, producto_id, peso, precio_unitario)
select f.id, f.producto_id, coalesce(f.peso_manual, t.peso_neto, 0), f.precio_unitario
from public.facturas_venta f
left join public.tickets_pesaje t on t.id = f.ticket_id
where not exists (select 1 from public.detalle_facturas_venta d where d.factura_id = f.id);

-- RPC atómica para factura de compra: header + N líneas + marca el ticket como
-- facturado. total = suma de (peso · precio) de las líneas.
-- p_items: jsonb array → [{ "producto_id": uuid, "peso": numeric, "precio_unitario": numeric }, ...]
create or replace function public.crear_factura_compra(
  p_proveedor_id  uuid,
  p_ticket_id     uuid,
  p_estado        text,
  p_descripcion   text,
  p_observaciones text,
  p_items         jsonb
) returns uuid
language plpgsql
as $$
declare
  v_id    uuid;
  v_item  jsonb;
  v_total numeric;
begin
  select coalesce(sum((value->>'peso')::numeric * (value->>'precio_unitario')::numeric), 0)
    into v_total
  from jsonb_array_elements(p_items) as elems(value);

  insert into public.facturas_compra
    (proveedor_id, ticket_id, precio_unitario, total, descripcion, observaciones, estado)
  values (
    p_proveedor_id, p_ticket_id, 0, v_total,
    nullif(p_descripcion, ''), nullif(p_observaciones, ''), coalesce(p_estado, 'emitida')
  )
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(p_items) as elems(value)
  loop
    insert into public.detalle_facturas_compra (factura_id, producto_id, peso, precio_unitario)
    values (
      v_id,
      (v_item->>'producto_id')::uuid,
      (v_item->>'peso')::numeric,
      (v_item->>'precio_unitario')::numeric
    );
  end loop;

  if p_ticket_id is not null then
    update public.tickets_pesaje set facturado = true where id = p_ticket_id;
  end if;

  return v_id;
end;
$$;

-- Igual que la anterior pero contra un cliente (factura de venta).
create or replace function public.crear_factura_venta(
  p_cliente_id    uuid,
  p_ticket_id     uuid,
  p_estado        text,
  p_descripcion   text,
  p_observaciones text,
  p_items         jsonb
) returns uuid
language plpgsql
as $$
declare
  v_id    uuid;
  v_item  jsonb;
  v_total numeric;
begin
  select coalesce(sum((value->>'peso')::numeric * (value->>'precio_unitario')::numeric), 0)
    into v_total
  from jsonb_array_elements(p_items) as elems(value);

  insert into public.facturas_venta
    (cliente_id, ticket_id, precio_unitario, total, descripcion, observaciones, estado)
  values (
    p_cliente_id, p_ticket_id, 0, v_total,
    nullif(p_descripcion, ''), nullif(p_observaciones, ''), coalesce(p_estado, 'emitida')
  )
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(p_items) as elems(value)
  loop
    insert into public.detalle_facturas_venta (factura_id, producto_id, peso, precio_unitario)
    values (
      v_id,
      (v_item->>'producto_id')::uuid,
      (v_item->>'peso')::numeric,
      (v_item->>'precio_unitario')::numeric
    );
  end loop;

  if p_ticket_id is not null then
    update public.tickets_pesaje set facturado = true where id = p_ticket_id;
  end if;

  return v_id;
end;
$$;


-- ============================================================================
-- Bloque 18 · destino por material en el ticket de pesaje (MPP / Lote)
--
-- Cada material pesado se asigna a un destino de inventario: MPP (Material Por
-- Procesar) o un Lote concreto. Los lotes son una lista gestionada (CRUD). El
-- inventario se calcula a partir de estas líneas, separado por destino: el mismo
-- material puede tener stock en MPP y en cada lote por separado.
-- ============================================================================

create table if not exists public.lotes (
  id         uuid        primary key default gen_random_uuid(),
  nombre     text        not null,
  activo     boolean     not null default true,
  created_at timestamptz not null default now()
);

alter table public.lotes disable row level security;

-- Nombre único sin distinguir mayúsculas ("Lote 1" == "lote 1").
create unique index if not exists idx_lotes_nombre on public.lotes (lower(nombre));

-- Destino de cada línea del ticket. Por defecto 'mpp' (material por procesar).
alter table public.detalle_tickets_pesaje
  add column if not exists destino_tipo text not null default 'mpp'
    check (destino_tipo in ('mpp', 'lote')),
  add column if not exists lote_id uuid references public.lotes(id);

create index if not exists idx_detalle_tickets_pesaje_lote
  on public.detalle_tickets_pesaje (lote_id);

-- Reemplaza la RPC (Bloque 16) para recibir el destino por material.
-- p_materiales: jsonb array → [{ "producto_id", "subcategoria", "peso_bruto",
--   "tara", "devolucion", "destino_tipo": "mpp"|"lote", "lote_id": uuid|null }, ...]
create or replace function public.crear_ticket_pesaje(
  p_tipo          text,
  p_entidad_id    uuid,
  p_fecha         date,
  p_fotos         text[],
  p_observaciones text,
  p_materiales    jsonb
) returns uuid
language plpgsql
as $$
declare
  v_id   uuid;
  v_item jsonb;
begin
  insert into public.tickets_pesaje (tipo, entidad_id, fecha, fotos, observaciones)
  values (p_tipo, p_entidad_id, p_fecha, p_fotos, nullif(p_observaciones, ''))
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(p_materiales) as elems(value)
  loop
    insert into public.detalle_tickets_pesaje
      (ticket_id, producto_id, subcategoria, peso_bruto, tara, devolucion, destino_tipo, lote_id)
    values (
      v_id,
      (v_item->>'producto_id')::uuid,
      nullif(v_item->>'subcategoria', ''),
      (v_item->>'peso_bruto')::numeric,
      (v_item->>'tara')::numeric,
      coalesce((v_item->>'devolucion')::numeric, 0),
      coalesce(nullif(v_item->>'destino_tipo', ''), 'mpp'),
      nullif(v_item->>'lote_id', '')::uuid
    );
  end loop;

  return v_id;
end;
$$;


-- ============================================================================
-- Bloque 19 · varios tickets de pesaje por factura
--
-- Una factura puede agrupar VARIOS tickets del mismo proveedor/cliente. La
-- relación deja de ser 1:1 (columna ticket_id en el header) y pasa a una tabla
-- puente. La columna ticket_id se conserva como LEGACY (las facturas nuevas la
-- dejan en null; la fuente de verdad es la tabla puente).
-- ============================================================================

create table if not exists public.facturas_compra_tickets (
  factura_id uuid not null references public.facturas_compra(id) on delete cascade,
  ticket_id  uuid not null references public.tickets_pesaje(id),
  primary key (factura_id, ticket_id)
);

create table if not exists public.facturas_venta_tickets (
  factura_id uuid not null references public.facturas_venta(id) on delete cascade,
  ticket_id  uuid not null references public.tickets_pesaje(id),
  primary key (factura_id, ticket_id)
);

alter table public.facturas_compra_tickets disable row level security;
alter table public.facturas_venta_tickets  disable row level security;

create index if not exists idx_facturas_compra_tickets_ticket on public.facturas_compra_tickets (ticket_id);
create index if not exists idx_facturas_venta_tickets_ticket  on public.facturas_venta_tickets (ticket_id);

-- Backfill: las facturas existentes con ticket_id pasan a la tabla puente (1:1).
insert into public.facturas_compra_tickets (factura_id, ticket_id)
select id, ticket_id from public.facturas_compra f
where f.ticket_id is not null
  and not exists (select 1 from public.facturas_compra_tickets ft where ft.factura_id = f.id and ft.ticket_id = f.ticket_id);

insert into public.facturas_venta_tickets (factura_id, ticket_id)
select id, ticket_id from public.facturas_venta f
where f.ticket_id is not null
  and not exists (select 1 from public.facturas_venta_tickets ft where ft.factura_id = f.id and ft.ticket_id = f.ticket_id);

-- Reemplazo de las RPCs: el parámetro pasa de un uuid a un arreglo de uuids.
-- Hay que DROP explícito porque cambia la firma (tipo del parámetro).
drop function if exists public.crear_factura_compra(uuid, uuid, text, text, text, jsonb);
drop function if exists public.crear_factura_venta(uuid, uuid, text, text, text, jsonb);

create or replace function public.crear_factura_compra(
  p_proveedor_id  uuid,
  p_ticket_ids    uuid[],
  p_estado        text,
  p_descripcion   text,
  p_observaciones text,
  p_items         jsonb
) returns uuid
language plpgsql
as $$
declare
  v_id     uuid;
  v_item   jsonb;
  v_total  numeric;
  v_ticket uuid;
begin
  select coalesce(sum((value->>'peso')::numeric * (value->>'precio_unitario')::numeric), 0)
    into v_total
  from jsonb_array_elements(p_items) as elems(value);

  insert into public.facturas_compra
    (proveedor_id, ticket_id, precio_unitario, total, descripcion, observaciones, estado)
  values (
    p_proveedor_id, null, 0, v_total,
    nullif(p_descripcion, ''), nullif(p_observaciones, ''), coalesce(p_estado, 'emitida')
  )
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(p_items) as elems(value)
  loop
    insert into public.detalle_facturas_compra (factura_id, producto_id, peso, precio_unitario)
    values (
      v_id,
      (v_item->>'producto_id')::uuid,
      (v_item->>'peso')::numeric,
      (v_item->>'precio_unitario')::numeric
    );
  end loop;

  if p_ticket_ids is not null then
    foreach v_ticket in array p_ticket_ids
    loop
      insert into public.facturas_compra_tickets (factura_id, ticket_id)
      values (v_id, v_ticket)
      on conflict do nothing;
      update public.tickets_pesaje set facturado = true where id = v_ticket;
    end loop;
  end if;

  return v_id;
end;
$$;

create or replace function public.crear_factura_venta(
  p_cliente_id    uuid,
  p_ticket_ids    uuid[],
  p_estado        text,
  p_descripcion   text,
  p_observaciones text,
  p_items         jsonb
) returns uuid
language plpgsql
as $$
declare
  v_id     uuid;
  v_item   jsonb;
  v_total  numeric;
  v_ticket uuid;
begin
  select coalesce(sum((value->>'peso')::numeric * (value->>'precio_unitario')::numeric), 0)
    into v_total
  from jsonb_array_elements(p_items) as elems(value);

  insert into public.facturas_venta
    (cliente_id, ticket_id, precio_unitario, total, descripcion, observaciones, estado)
  values (
    p_cliente_id, null, 0, v_total,
    nullif(p_descripcion, ''), nullif(p_observaciones, ''), coalesce(p_estado, 'emitida')
  )
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(p_items) as elems(value)
  loop
    insert into public.detalle_facturas_venta (factura_id, producto_id, peso, precio_unitario)
    values (
      v_id,
      (v_item->>'producto_id')::uuid,
      (v_item->>'peso')::numeric,
      (v_item->>'precio_unitario')::numeric
    );
  end loop;

  if p_ticket_ids is not null then
    foreach v_ticket in array p_ticket_ids
    loop
      insert into public.facturas_venta_tickets (factura_id, ticket_id)
      values (v_id, v_ticket)
      on conflict do nothing;
      update public.tickets_pesaje set facturado = true where id = v_ticket;
    end loop;
  end if;

  return v_id;
end;
$$;


-- ============================================================================
-- Bloque 21 · peso global + pesaje en bruto (Tareas 3 y 6)
--
-- Reconciliación manual: las ramas feature/pesaje-peso-global (Tarea 3) y
-- feature/pesaje-en-bruto (Tarea 6) modificaban el mismo RPC
-- crear_ticket_pesaje cada una con parámetros nuevos distintos. Este bloque
-- fusiona ambas — el RPC final acepta los 4 parámetros nuevos juntos.
--
-- Peso global (Tarea 3): el proveedor se pesa UNA sola vez con todos los
-- materiales juntos al llegar (peso_global). Después se desglosan los pesos
-- netos por material como ya hacía la app (detalle_tickets_pesaje):
--
--   diferencia = peso_global - (suma de netos por material [incluida la
--                basura, que es una fila de material más] + devolución total)
--
-- La diferencia NO se guarda (se deriva en el backend). Solo se persiste
-- peso_global.
--
-- Pesaje en bruto (Tarea 6): un ticket de compra se puede guardar "en bruto"
-- (sin materiales ni destinos asignados todavía). No mueve inventario (no
-- tiene filas en detalle_tickets_pesaje hasta completarse) y no se puede
-- facturar mientras estado='bruto' (validado en backend, factura-service.ts).
-- Solo aplica a compras. pesado_por = quien creó el ticket (bruto o
-- completo); completado_por/completado_en solo se llenan al completar un
-- bruto (vía la RPC completar_ticket_pesaje).
-- ============================================================================

alter table public.tickets_pesaje
  add column if not exists peso_global numeric;

alter table public.tickets_pesaje
  add column if not exists estado text not null default 'completo'
    check (estado in ('bruto', 'completo'));

alter table public.tickets_pesaje
  add column if not exists pesado_por uuid references public.users(id);
alter table public.tickets_pesaje
  add column if not exists completado_por uuid references public.users(id);
alter table public.tickets_pesaje
  add column if not exists completado_en timestamptz;

-- Reemplaza la RPC (Bloque 18) para recibir peso_global + estado + pesado_por,
-- y permitir materiales vacíos (el bruto se completa después con otra RPC).
drop function if exists public.crear_ticket_pesaje(text, uuid, date, text[], text, jsonb);

create or replace function public.crear_ticket_pesaje(
  p_tipo          text,
  p_entidad_id    uuid,
  p_fecha         date,
  p_fotos         text[],
  p_observaciones text,
  p_materiales    jsonb,
  p_estado        text,
  p_pesado_por    uuid,
  p_peso_global   numeric
) returns uuid
language plpgsql
as $$
declare
  v_id   uuid;
  v_item jsonb;
begin
  insert into public.tickets_pesaje
    (tipo, entidad_id, fecha, fotos, observaciones, estado, pesado_por, peso_global)
  values (
    p_tipo, p_entidad_id, p_fecha, p_fotos, nullif(p_observaciones, ''),
    coalesce(p_estado, 'completo'), p_pesado_por, p_peso_global
  )
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_materiales, '[]'::jsonb)) as elems(value)
  loop
    insert into public.detalle_tickets_pesaje
      (ticket_id, producto_id, subcategoria, peso_bruto, tara, devolucion, destino_tipo, lote_id)
    values (
      v_id,
      (v_item->>'producto_id')::uuid,
      nullif(v_item->>'subcategoria', ''),
      (v_item->>'peso_bruto')::numeric,
      (v_item->>'tara')::numeric,
      coalesce((v_item->>'devolucion')::numeric, 0),
      coalesce(nullif(v_item->>'destino_tipo', ''), 'mpp'),
      nullif(v_item->>'lote_id', '')::uuid
    );
  end loop;

  return v_id;
end;
$$;

-- Completa un ticket en bruto: agrega las líneas de material definitivas y
-- pasa estado a 'completo', registrando quién lo completó y cuándo.
create or replace function public.completar_ticket_pesaje(
  p_ticket_id      uuid,
  p_materiales     jsonb,
  p_completado_por uuid
) returns uuid
language plpgsql
as $$
declare
  v_estado text;
  v_item   jsonb;
begin
  select estado into v_estado from public.tickets_pesaje where id = p_ticket_id;

  if v_estado is null then
    raise exception 'Ticket no encontrado.';
  end if;
  if v_estado <> 'bruto' then
    raise exception 'El ticket ya está completo.';
  end if;

  for v_item in select value from jsonb_array_elements(p_materiales) as elems(value)
  loop
    insert into public.detalle_tickets_pesaje
      (ticket_id, producto_id, subcategoria, peso_bruto, tara, devolucion, destino_tipo, lote_id)
    values (
      p_ticket_id,
      (v_item->>'producto_id')::uuid,
      nullif(v_item->>'subcategoria', ''),
      (v_item->>'peso_bruto')::numeric,
      (v_item->>'tara')::numeric,
      coalesce((v_item->>'devolucion')::numeric, 0),
      coalesce(nullif(v_item->>'destino_tipo', ''), 'mpp'),
      nullif(v_item->>'lote_id', '')::uuid
    );
  end loop;

  update public.tickets_pesaje
     set estado = 'completo',
         completado_por = p_completado_por,
         completado_en = now()
   where id = p_ticket_id;

  return p_ticket_id;
end;
$$;