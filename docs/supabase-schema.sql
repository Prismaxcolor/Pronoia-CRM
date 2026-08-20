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
--                    banca_destino_id += coalesce(monto_destino, monto)
--
-- monto_destino (columna agregada después, ver movimientos.monto_destino):
-- cuando la transferencia es entre bancas de monedas distintas (Bs↔USD),
-- `monto` es lo que sale de la banca origen (en su moneda) y `monto_destino`
-- es lo que entra a la banca destino (en la suya), aplicando la tasa elegida
-- al momento de la transferencia. Si es null (transferencia misma moneda),
-- se usa `monto` para ambos lados.
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
       set saldo = saldo + coalesce(new.monto_destino, new.monto)
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

-- monto_destino: solo se llena en transferencias entre bancas de monedas
-- distintas (lo que entra a la banca destino, en su propia moneda).
alter table public.movimientos
  add column if not exists monto_destino numeric null;


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
           when tipo = 'transferencia' and banca_destino_id = p_banca_id then  coalesce(monto_destino, monto)
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
-- SUPERADO por el Bloque 40 (rediseño completo de Transformaciones) — estas
-- tablas y la RPC crear_transformacion (Bloque 12) fueron reemplazadas por
-- completo. Se dejan aquí sin tocar como registro histórico de la primera
-- versión; el Bloque 40 las hace DROP explícitamente antes de crear las
-- nuevas.
--
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
-- SUPERADO por el Bloque 40 — ver nota ahí.
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
-- Las facturas de venta tienen su propio correlativo espejo en el Bloque 29.
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
-- Bloque 20 · limpieza pendiente tras eliminar costos de productos (Tarea 1)
--
-- El cliente pidió eliminar TODOS los costos del catálogo de productos (Costo
-- unitario del tipo Básico y Costo calculado del tipo Compuesto). El código ya
-- dejó de leer/escribir estas columnas, pero se conservan en la tabla por si
-- hay que revertir o auditar datos históricos. NO se ejecuta automáticamente:
-- correr manualmente solo cuando se confirme que ya no hace falta el dato.
--
--   alter table public.productos drop column if exists costo_unitario;
--   alter table public.productos drop column if exists costo_calculado;
--
-- Además, el módulo frontend de "Factura genérica" (carrito tipo POS, distinto
-- del flujo real de compras/ventas por pesaje) se eliminó del código porque
-- dependía de esos costos como precio y el dominio del proyecto excluye
-- explícitamente un carrito de cliente (ver CLAUDE.md). Las tablas que usaba
-- (`facturas`, `factura_items`) ya no reciben escrituras del frontend. Se
-- dejan sin borrar por si tienen historial que el cliente quiera conservar:
--
--   drop table if exists public.factura_items;
--   drop table if exists public.facturas;
-- ============================================================================


-- ============================================================================
-- Bloque 21 · catálogo de taras predefinidas (Tarea 7)
--
-- Taras globales reutilizables (nombre + peso + foto), gestionadas desde
-- Configuración. Todos los usuarios las ven y usan; el permiso 'productos'
-- controla quién puede crearlas/editarlas (mismo patrón que tipos_material).
-- ============================================================================

create table if not exists public.taras (
  id         uuid           primary key default gen_random_uuid(),
  nombre     text           not null,
  peso       numeric(10, 2) not null check (peso > 0),
  foto       text,
  activo     boolean        not null default true,
  created_at timestamptz    not null default now()
);

alter table public.taras disable row level security;

create index if not exists idx_taras_activas on public.taras (activo, nombre);

-- Bucket de Storage 'taras' para las fotos: crear manualmente en Supabase
-- Studio → Storage (público, igual que 'productos'/'tickets'), luego correr
-- esta política para que la anon key pueda subir/leer (mismo patrón Bloque 13).
drop policy if exists "taras acceso anon" on storage.objects;
create policy "taras acceso anon"
  on storage.objects for all
  to anon, authenticated
  using (bucket_id = 'taras')
  with check (bucket_id = 'taras');


-- ============================================================================
-- Bloque 22 · pagos a proveedores (Tarea 8)
--
-- Un pago a proveedor es un movimiento de tesorería (egreso) atribuido al
-- proveedor (proveedor_id, ya existente desde el Bloque 9). Los pagos SIEMPRE
-- se contabilizan en USD para el estado de cuenta (facturas_compra.total está
-- en USD), aunque la banca de origen sea en bolívares: `monto`/`moneda` del
-- movimiento reflejan lo que realmente sale de esa banca (para que el trigger
-- de saldo — Bloque 2 — descuente en la moneda correcta), y `monto_usd` guarda
-- el equivalente en USD que se aplica a la factura y al estado de cuenta.
--
-- facturas_compra.monto_pagado acumula lo abonado (en USD) para poder marcar
-- la factura como 'pagada' automáticamente al llegar a su total, permitiendo
-- pagos parciales.
-- ============================================================================

alter table public.movimientos
  add column if not exists monto_usd numeric;

-- La tabla movimientos es preexistente y traía referencia como NOT NULL
-- (pensada para los tipos de movimiento anteriores, que siempre la
-- completaban). Los pagos a proveedores la dejan opcional (adelantos sin
-- referencia), así que hay que permitir NULL explícitamente.
alter table public.movimientos
  alter column referencia drop not null;

alter table public.facturas_compra
  add column if not exists monto_pagado numeric not null default 0;

-- RPC atómica: inserta el movimiento (el trigger del Bloque 2 ajusta el saldo
-- de la banca automáticamente) y, si viene ligado a una factura, acumula el
-- abono y la marca 'pagada' cuando el acumulado alcanza el total.
create or replace function public.registrar_pago_proveedor(
  p_proveedor_id   uuid,
  p_banca_id       uuid,
  p_monto          numeric,   -- en la moneda de la banca de origen
  p_moneda         text,
  p_monto_usd      numeric,   -- equivalente en USD, siempre presente
  p_descripcion    text,
  p_referencia     text,
  p_fecha          date,
  p_registrado_por uuid,
  p_factura_id     uuid       -- null = adelanto sin ligar a una factura
) returns uuid
language plpgsql
as $$
declare
  v_mov_id  uuid;
  v_total   numeric;
  v_pagado  numeric;
begin
  insert into public.movimientos
    (tipo, monto, moneda, monto_usd, descripcion, banca_origen_id, banca_destino_id,
     fecha, referencia, registrado_por, proveedor_id)
  values
    ('egreso', p_monto, p_moneda, p_monto_usd, nullif(p_descripcion, ''), p_banca_id, null,
     p_fecha, nullif(p_referencia, ''), p_registrado_por, p_proveedor_id)
  returning id into v_mov_id;

  if p_factura_id is not null then
    select total, monto_pagado into v_total, v_pagado
      from public.facturas_compra where id = p_factura_id;

    if v_total is null then
      raise exception 'Factura no encontrada.';
    end if;

    v_pagado := coalesce(v_pagado, 0) + p_monto_usd;

    update public.facturas_compra
       set monto_pagado = v_pagado,
           estado = case when v_pagado >= v_total - 0.01 then 'pagada' else estado end
     where id = p_factura_id;
  end if;

  return v_mov_id;
end;
$$;


-- ============================================================================
-- Bloque 23 · peso global + pesaje en bruto (Tareas 3 y 6)
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

-- Bloque 24 · integración Telegram (documentos + comprobantes de pago)
-- Vinculación self-service de proveedores/clientes a un bot de Telegram dedicado
-- (distinto del bot interno de permisos gubernamentales). Ver
-- clients/PRONOIA/integracion-telegram/PLAN.md en el workspace de la agencia.

alter table public.proveedores
  add column if not exists telegram_chat_id text,
  add column if not exists telegram_linked_at timestamptz;

alter table public.clientes
  add column if not exists telegram_chat_id text,
  add column if not exists telegram_linked_at timestamptz;

create table if not exists public.telegram_link_tokens (
  id uuid primary key default gen_random_uuid(),
  entidad_tipo text not null check (entidad_tipo in ('proveedor', 'cliente')),
  entidad_id uuid not null,
  token text not null unique,
  usado boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '48 hours')
);

create index if not exists idx_telegram_link_tokens_token
  on public.telegram_link_tokens (token);

-- Evita que dos proveedores/clientes distintos queden vinculados al mismo chat de
-- Telegram (mezclaría a quién le llegan documentos y comprobantes de pago).
create unique index if not exists idx_proveedores_telegram_chat_id
  on public.proveedores (telegram_chat_id) where telegram_chat_id is not null;

create unique index if not exists idx_clientes_telegram_chat_id
  on public.clientes (telegram_chat_id) where telegram_chat_id is not null;

alter table public.movimientos
  add column if not exists comprobante_url text;

-- Bloque 25 · Fase 1 de Telegram — envío de ticket/factura por Telegram
-- Registro de entregas fallidas (Telegram caído, chat_id inválido, etc.) para que el
-- gerente pueda ver desde el dashboard qué no llegó y reenviarlo. Lo escribe el
-- workflow n8n "Enviar Documento a Proveedor", no el backend.
create table if not exists public.notificaciones_fallidas (
  id uuid primary key default gen_random_uuid(),
  entidad_tipo text not null check (entidad_tipo in ('proveedor', 'cliente')),
  entidad_id uuid not null,
  tipo_documento text not null,
  nombre_archivo text,
  url text,
  error text,
  resuelto boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notificaciones_fallidas_pendientes
  on public.notificaciones_fallidas (entidad_id) where resuelto = false;

-- Bloque 26 · Portal de proveedores/clientes
-- Login sin contraseña (magic link vía Telegram), agendamiento de despacho, y guías
-- CORPOEZ ligadas a la entidad correspondiente. Ver
-- clients/PRONOIA/portal-clientes/PLAN.md en el workspace de la agencia.

-- Tabla separada de telegram_link_tokens (Bloque 24) a propósito: mezclar tokens de
-- vinculación con tokens de login sería un riesgo de seguridad sutil.
create table if not exists public.portal_login_tokens (
  id uuid primary key default gen_random_uuid(),
  entidad_tipo text not null check (entidad_tipo in ('proveedor', 'cliente')),
  entidad_id uuid not null,
  token text not null unique,
  usado boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes')
);

create index if not exists idx_portal_login_tokens_token
  on public.portal_login_tokens (token);

create table if not exists public.citas_despacho (
  id uuid primary key default gen_random_uuid(),
  entidad_tipo text not null check (entidad_tipo in ('proveedor', 'cliente')),
  entidad_id uuid not null,
  fecha date not null,
  hora time not null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'confirmada', 'reprogramada', 'cancelada', 'completada')),
  notas text,
  created_at timestamptz not null default now()
);

create index if not exists idx_citas_despacho_fecha
  on public.citas_despacho (fecha) where estado not in ('cancelada', 'completada');

-- La escribe el workflow n8n de permisos gubernamentales (modificado aparte, fuera de
-- este repo), no el backend — acá solo se lee para mostrarla en el portal.
create table if not exists public.guias_corpoez (
  id uuid primary key default gen_random_uuid(),
  entidad_tipo text not null check (entidad_tipo in ('proveedor', 'cliente')),
  entidad_id uuid not null,
  estado text not null default 'solicitada'
    check (estado in ('solicitada', 'en_tramite', 'lista', 'rechazada')),
  url_pdf text,
  numero_guia text,
  created_at timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists idx_guias_corpoez_entidad
  on public.guias_corpoez (entidad_tipo, entidad_id);


-- ============================================================================
-- Bloque 27 · edición de tickets de pesaje completos (Tarea 2 — corrección de
-- errores de registro)
--
-- Permite corregir un ticket ya 'completo' (material, pesos, tara, destino,
-- peso_global, observaciones) SOLO mientras no esté facturado — una vez que
-- existe una factura asociada, el ticket queda congelado para no descuadrar
-- lo ya emitido. Reemplaza todas las líneas de detalle_tickets_pesaje del
-- ticket (igual que completar_ticket_pesaje, pero partiendo de un ticket que
-- ya tenía materiales en vez de uno en bruto).
-- ============================================================================

create or replace function public.editar_ticket_pesaje(
  p_ticket_id     uuid,
  p_materiales    jsonb,
  p_peso_global   numeric default null,
  p_observaciones text default null
) returns uuid
language plpgsql
as $$
declare
  v_estado    text;
  v_facturado boolean;
  v_item      jsonb;
begin
  select estado, facturado into v_estado, v_facturado
    from public.tickets_pesaje where id = p_ticket_id;

  if v_estado is null then
    raise exception 'Ticket no encontrado.';
  end if;
  if v_estado <> 'completo' then
    raise exception 'Solo se pueden editar tickets completos (usa completar_ticket_pesaje para uno en bruto).';
  end if;
  if v_facturado then
    raise exception 'No se puede editar un ticket ya facturado.';
  end if;

  update public.tickets_pesaje
     set peso_global   = coalesce(p_peso_global, peso_global),
         observaciones = coalesce(nullif(p_observaciones, ''), observaciones)
   where id = p_ticket_id;

  delete from public.detalle_tickets_pesaje where ticket_id = p_ticket_id;

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

  return p_ticket_id;
end;
$$;


-- ============================================================================
-- Bloque 28 · notas de crédito y débito para proveedores
--
-- Ajuste manual del saldo pendiente del proveedor en su Estado de Cuenta, sin
-- factura ni pago real: nota de crédito resta del saldo (a favor de la
-- empresa, ej. descuento de flete), nota de débito suma al saldo (a favor del
-- proveedor, ej. comisión). NO generan movimientos de tesorería ni tocan
-- bancas/Cochinito — el saldo de las bancas solo cambia con dinero real
-- (regla del proyecto).
--
-- Corrección de errores: en finanzas nunca se borra (regla del proyecto). Una
-- nota mal cargada se anula con una nota contraria del mismo monto (RPC
-- abajo), que además marca la original como `anulada` para que el Estado de
-- Cuenta la muestre tachada — ambas quedan visibles para auditoría, y su
-- efecto neto en el saldo se cancela solo.
-- ============================================================================

create table if not exists public.notas_ajuste_proveedor (
  id              uuid        primary key default gen_random_uuid(),
  proveedor_id    uuid        not null references public.proveedores(id),
  tipo            text        not null check (tipo in ('credito', 'debito')),
  monto           numeric     not null check (monto > 0),
  motivo          text        not null,
  anulada         boolean     not null default false,
  anula_nota_id   uuid        references public.notas_ajuste_proveedor(id),
  registrado_por  uuid        references public.users(id),
  created_at      timestamptz not null default now()
);

alter table public.notas_ajuste_proveedor disable row level security;

create index if not exists idx_notas_ajuste_proveedor_proveedor
  on public.notas_ajuste_proveedor (proveedor_id);

-- RPC atómica: inserta la nota contraria (mismo monto, tipo invertido, ligada
-- a la original vía anula_nota_id) y marca la original como anulada.
create or replace function public.anular_nota_ajuste_proveedor(
  p_nota_id        uuid,
  p_motivo         text,
  p_registrado_por uuid
) returns uuid
language plpgsql
as $$
declare
  v_proveedor_id uuid;
  v_tipo         text;
  v_monto        numeric;
  v_anulada      boolean;
  v_nueva_id     uuid;
begin
  select proveedor_id, tipo, monto, anulada
    into v_proveedor_id, v_tipo, v_monto, v_anulada
    from public.notas_ajuste_proveedor
   where id = p_nota_id;

  if v_proveedor_id is null then
    raise exception 'Nota no encontrada.';
  end if;
  if v_anulada then
    raise exception 'Esta nota ya fue anulada.';
  end if;

  insert into public.notas_ajuste_proveedor
    (proveedor_id, tipo, monto, motivo, anula_nota_id, registrado_por)
  values (
    v_proveedor_id,
    case when v_tipo = 'credito' then 'debito' else 'credito' end,
    v_monto,
    p_motivo,
    p_nota_id,
    p_registrado_por
  )
  returning id into v_nueva_id;

  update public.notas_ajuste_proveedor set anulada = true where id = p_nota_id;

  return v_nueva_id;
end;
$$;


-- ============================================================================
-- Bloque 29 · correlativo automático de facturas de venta
--
-- Espejo exacto del Bloque 15 (compras). Se agrega porque el cliente pidió que
-- las ventas también lleven número de control ("V-0001"). Deja sin efecto la
-- nota del Bloque 15 que decía que las de venta "no lo llevan por ahora".
-- ============================================================================

create sequence if not exists public.facturas_venta_numero_seq;

alter table public.facturas_venta
  add column if not exists numero bigint;

-- Backfill: numera las facturas existentes en orden de creación.
update public.facturas_venta f
set numero = o.rn
from (
  select id, row_number() over (order by created_at, id) as rn
  from public.facturas_venta
  where numero is null
) o
where f.id = o.id;

-- Avanza la secuencia más allá del máximo ya asignado.
select setval(
  'public.facturas_venta_numero_seq',
  coalesce((select max(numero) from public.facturas_venta), 0) + 1,
  false
);

-- Nuevas filas toman el siguiente valor de la secuencia automáticamente.
alter table public.facturas_venta
  alter column numero set default nextval('public.facturas_venta_numero_seq');

alter table public.facturas_venta
  alter column numero set not null;

-- Garantiza unicidad del correlativo.
create unique index if not exists idx_facturas_venta_numero
  on public.facturas_venta (numero);


-- ============================================================================
-- Bloque 30 · devolución a nivel de ticket (rediseñado 05-ago-2026)
--
-- Kg de devolución, capturados UNA sola vez por ticket (no por material). Se
-- SUMA a la suma de materiales para reconciliar contra el peso global — no
-- resta de inventario ni de factura, es un campo informativo/de conciliación:
--
--   diferencia = peso_global - (suma de netos por material) - devolucion
--
-- Los 3 RPCs ganan p_devolucion como parámetro FINAL con default, vía
-- `create or replace function` — Postgres permite esto sin `drop function`,
-- así que no hay ventana donde el RPC no exista.
-- ============================================================================

alter table public.tickets_pesaje
  add column if not exists devolucion numeric not null default 0
    check (devolucion >= 0);

create or replace function public.crear_ticket_pesaje(
  p_tipo          text,
  p_entidad_id    uuid,
  p_fecha         date,
  p_fotos         text[],
  p_observaciones text,
  p_materiales    jsonb,
  p_estado        text,
  p_pesado_por    uuid,
  p_peso_global   numeric,
  p_devolucion    numeric default 0
) returns uuid
language plpgsql
as $$
declare
  v_id   uuid;
  v_item jsonb;
begin
  insert into public.tickets_pesaje
    (tipo, entidad_id, fecha, fotos, observaciones, estado, pesado_por, peso_global, devolucion)
  values (
    p_tipo, p_entidad_id, p_fecha, p_fotos, nullif(p_observaciones, ''),
    coalesce(p_estado, 'completo'), p_pesado_por, p_peso_global, coalesce(p_devolucion, 0)
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

create or replace function public.completar_ticket_pesaje(
  p_ticket_id      uuid,
  p_materiales     jsonb,
  p_completado_por uuid,
  p_devolucion     numeric default null
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
         completado_en = now(),
         devolucion = coalesce(p_devolucion, devolucion)
   where id = p_ticket_id;

  return p_ticket_id;
end;
$$;

create or replace function public.editar_ticket_pesaje(
  p_ticket_id     uuid,
  p_materiales    jsonb,
  p_peso_global   numeric default null,
  p_observaciones text default null,
  p_devolucion    numeric default null
) returns uuid
language plpgsql
as $$
declare
  v_estado    text;
  v_facturado boolean;
  v_item      jsonb;
begin
  select estado, facturado into v_estado, v_facturado
    from public.tickets_pesaje where id = p_ticket_id;

  if v_estado is null then
    raise exception 'Ticket no encontrado.';
  end if;
  if v_estado <> 'completo' then
    raise exception 'Solo se pueden editar tickets completos (usa completar_ticket_pesaje para uno en bruto).';
  end if;
  if v_facturado then
    raise exception 'No se puede editar un ticket ya facturado.';
  end if;

  update public.tickets_pesaje
     set peso_global   = coalesce(p_peso_global, peso_global),
         observaciones = coalesce(nullif(p_observaciones, ''), observaciones),
         devolucion    = coalesce(p_devolucion, devolucion)
   where id = p_ticket_id;

  delete from public.detalle_tickets_pesaje where ticket_id = p_ticket_id;

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

  return p_ticket_id;
end;
$$;


-- ============================================================================
-- Bloque 31 · slot único de citas de despacho (Tarea 11)
--
-- crearCita ya validaba colisión con un SELECT + INSERT no atómico (bug
-- preexistente del portal, no introducido acá). Al agregar agendamiento por
-- staff (mismo servicio, más superficie de exposición) se cierra de verdad
-- con un índice único: dos agendamientos simultáneos para el mismo
-- fecha+hora ya no pueden colar ambos.
-- ============================================================================

create unique index if not exists idx_citas_despacho_slot
  on public.citas_despacho (fecha, hora)
  where estado in ('pendiente', 'confirmada', 'reprogramada');


-- ============================================================================
-- Bloque 32 · listas de precios separadas por tipo (compra / venta)
--
-- listas_precios ya era genérica (facturas_compra y facturas_venta ya
-- referenciaban lista_precios_id cada una); lo que faltaba era el
-- discriminador para que el selector de una factura de venta no ofreciera
-- listas pensadas para compra. Todo lo existente se marca 'compra' por
-- defecto — es el uso real que tenía hasta hoy.
-- ============================================================================

alter table public.listas_precios
  add column if not exists tipo text not null default 'compra'
    check (tipo in ('compra', 'venta'));

create index if not exists idx_listas_precios_tipo
  on public.listas_precios (tipo, activo, nombre);


-- ============================================================================
-- Bloque 33 · Almacenes y traslados entre almacenes (Tareas 17/18, MVP)
--
-- Primer armado para que Julio se haga una idea, no la versión final: agrega
-- el catálogo de almacenes (CRUD simple) y un tipo de operación de pesaje
-- nuevo, "traslado", que mueve material de un almacén a otro con su propio
-- flujo pendiente → completado (como un ticket de pesaje, pero recepciona en
-- vez de facturar). No toca tickets_pesaje/detalle_tickets_pesaje ni el
-- concepto existente destino_tipo (mpp/lote) — es un sistema paralelo,
-- deliberadamente aislado para no arriesgar el inventario ya en producción.
--
-- Stock por almacén: derivado 100% de traslados COMPLETADOS (recepciones -
-- envíos), igual que el resto del inventario del sistema ya es derivado y no
-- una tabla de saldo. Un almacén nuevo empieza en 0 para todo — no hay forma
-- de asignarle un stock inicial en este primer armado (deliberado, fuera de
-- alcance de esta pasada).
-- ============================================================================

create table if not exists public.almacenes (
  id         uuid        primary key default gen_random_uuid(),
  nombre     text        not null unique,
  detalle    text,
  activo     boolean     not null default true,
  created_at timestamptz not null default now()
);

alter table public.almacenes disable row level security;

create index if not exists idx_almacenes_activos
  on public.almacenes (activo, nombre);


create sequence if not exists public.tickets_traslado_numero_seq;

create table if not exists public.tickets_traslado (
  id                 uuid        primary key default gen_random_uuid(),
  numero             bigint      not null default nextval('public.tickets_traslado_numero_seq'),
  almacen_origen_id  uuid        not null references public.almacenes(id),
  almacen_destino_id uuid        not null references public.almacenes(id),
  estado             text        not null default 'pendiente' check (estado in ('pendiente', 'completo')),
  observaciones      text,
  fotos              text[],
  pesado_por         uuid references public.users(id),
  completado_por     uuid references public.users(id),
  completado_en      timestamptz,
  created_at         timestamptz not null default now(),
  constraint chk_traslado_origen_destino_distintos check (almacen_origen_id <> almacen_destino_id)
);

alter table public.tickets_traslado disable row level security;

create unique index if not exists idx_tickets_traslado_numero
  on public.tickets_traslado (numero);

create index if not exists idx_tickets_traslado_estado
  on public.tickets_traslado (estado, created_at desc);


-- peso_neto: igual criterio que detalle_tickets_pesaje (bruto - tara). Sin
-- devolución acá — no aplica a un traslado interno.
-- peso_recibido: nulo hasta que se completa el traslado (lo llena quien
-- recepciona); es lo que realmente movió el inventario del almacén destino.
create table if not exists public.detalle_traslado (
  id             uuid        primary key default gen_random_uuid(),
  traslado_id    uuid        not null references public.tickets_traslado(id) on delete cascade,
  producto_id    uuid        references public.productos(id),
  subcategoria   text,
  peso_bruto     numeric,
  tara           numeric,
  peso_neto      numeric     generated always as (peso_bruto - tara) stored,
  peso_recibido  numeric,
  created_at     timestamptz not null default now()
);

alter table public.detalle_traslado disable row level security;

create index if not exists idx_detalle_traslado_traslado
  on public.detalle_traslado (traslado_id);


-- RPC atómica: crea el header (numero vía default, estado 'pendiente') + N
-- líneas de material sin peso_recibido todavía. Mismo patrón que
-- crear_ticket_pesaje (Bloque 16/23).
create or replace function public.crear_traslado(
  p_almacen_origen_id  uuid,
  p_almacen_destino_id uuid,
  p_observaciones      text,
  p_materiales         jsonb,
  p_pesado_por         uuid
) returns uuid
language plpgsql
as $$
declare
  v_id   uuid;
  v_item jsonb;
begin
  if p_almacen_origen_id = p_almacen_destino_id then
    raise exception 'El almacén de origen y destino no pueden ser el mismo.';
  end if;

  insert into public.tickets_traslado
    (almacen_origen_id, almacen_destino_id, observaciones, pesado_por)
  values (
    p_almacen_origen_id, p_almacen_destino_id, nullif(p_observaciones, ''), p_pesado_por
  )
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_materiales, '[]'::jsonb)) as elems(value)
  loop
    insert into public.detalle_traslado
      (traslado_id, producto_id, subcategoria, peso_bruto, tara)
    values (
      v_id,
      (v_item->>'producto_id')::uuid,
      nullif(v_item->>'subcategoria', ''),
      (v_item->>'peso_bruto')::numeric,
      (v_item->>'tara')::numeric
    );
  end loop;

  return v_id;
end;
$$;


-- RPC atómica: registra lo recibido por línea de material (puede diferir de
-- lo enviado — la diferencia se deriva en el backend, igual que
-- diferencia en tickets_pesaje) y marca el traslado 'completo'. Exige fotos
-- de evidencia (al menos 1) — se valida acá y también en el backend, doble
-- verificación intencional igual que otros flujos de este sistema.
create or replace function public.completar_traslado(
  p_traslado_id     uuid,
  p_recepciones     jsonb,
  p_fotos           text[],
  p_completado_por  uuid
) returns uuid
language plpgsql
as $$
declare
  v_estado text;
  v_item   jsonb;
begin
  select estado into v_estado from public.tickets_traslado where id = p_traslado_id;

  if v_estado is null then
    raise exception 'Traslado no encontrado.';
  end if;
  if v_estado <> 'pendiente' then
    raise exception 'El traslado ya está completo.';
  end if;
  if p_fotos is null or array_length(p_fotos, 1) is null or array_length(p_fotos, 1) < 1 then
    raise exception 'La recepción requiere al menos una foto de evidencia.';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_recepciones, '[]'::jsonb)) as elems(value)
  loop
    update public.detalle_traslado
       set peso_recibido = (v_item->>'peso_recibido')::numeric
     where id = (v_item->>'detalle_id')::uuid
       and traslado_id = p_traslado_id;
  end loop;

  update public.tickets_traslado
     set estado         = 'completo',
         fotos           = p_fotos,
         completado_por  = p_completado_por,
         completado_en   = now()
   where id = p_traslado_id;

  return p_traslado_id;
end;
$$;


-- Stock derivado por almacén: recepciones completadas (entran) menos envíos
-- completados (salen), por producto. Traslados 'pendiente' NO se cuentan —
-- el material sigue físicamente en el almacén de origen hasta que alguien
-- confirma la recepción. Un almacén nuevo sin movimientos no aparece en el
-- resultado (equivale a stock 0 para todo).
create or replace function public.stock_almacen(p_almacen_id uuid)
returns table(producto_id uuid, stock numeric)
language sql
stable
as $$
  select producto_id, sum(entrada) - sum(salida) as stock
  from (
    select dt.producto_id, coalesce(dt.peso_recibido, 0) as entrada, 0::numeric as salida
    from public.detalle_traslado dt
    join public.tickets_traslado t on t.id = dt.traslado_id
    where t.almacen_destino_id = p_almacen_id and t.estado = 'completo'
    union all
    select dt.producto_id, 0::numeric, coalesce(dt.peso_neto, 0) as salida
    from public.detalle_traslado dt
    join public.tickets_traslado t on t.id = dt.traslado_id
    where t.almacen_origen_id = p_almacen_id and t.estado = 'completo'
  ) x
  group by producto_id;
$$;

-- ============================================================================
-- Bloque 34 · Almacén predeterminado + compras/ventas que mueven inventario
--             de almacén (mejora 1 sobre el MVP del Bloque 33)
--
-- Qué cambia respecto al Bloque 33:
--  1. almacenes.es_predeterminado: como máximo UN almacén predeterminado a la
--     vez (índice único parcial). Es el único que recibe/pierde stock
--     automáticamente por compra/venta — no hay selector en Pesaje.
--  2. tickets_pesaje.almacen_id (nullable): a qué almacén afectó ese pesaje.
--     Se llena solo, dentro de crear_ticket_pesaje, con el predeterminado
--     ACTIVO del momento. NO se agrega como parámetro nuevo de la función —
--     agregar un parámetro crea una función sobrecargada distinta en
--     Postgres (mismo problema que ya resolvió el drop function del Bloque
--     23) — se resuelve dentro del cuerpo, la firma de 10 parámetros queda
--     intacta.
--  3. stock_almacen() ahora suma también compras (entran) y ventas (salen)
--     del almacén, no solo traslados.
--  4. Backfill (34.6): confirmado por Julio 07-ago-2026 — los 19 tickets de
--     compra/venta anteriores a este bloque (sin almacen_id) se asignan a
--     Almacén G2 (id c2ce16a1-e832-4f95-8c2a-bfcc9dbb131c). Verificado antes
--     y después: totales de compra (1638.66 kg) y venta (101 kg) sin cambios.
--
-- Aditivo y no destructivo en su estructura: no borra ni reescribe pesos ni
-- montos, no cambia el cálculo del inventario general (nunca lee almacen_id)
-- y no toca los tickets ya facturados salvo la nueva columna almacen_id.
-- ============================================================================

alter table public.almacenes
  add column if not exists es_predeterminado boolean not null default false;

-- Máximo un predeterminado: unicidad del valor `true` entre las filas que lo
-- tienen. Las filas en false no participan del índice parcial.
create unique index if not exists idx_almacenes_un_solo_predeterminado
  on public.almacenes (es_predeterminado)
  where es_predeterminado;

-- Desmarca el anterior y marca el nuevo en la MISMA transacción y en ese
-- orden — el índice único se verifica por sentencia, así que invertir el
-- orden dispararía una colisión transitoria.
create or replace function public.marcar_almacen_predeterminado(p_almacen_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_activo boolean;
begin
  select activo into v_activo from public.almacenes where id = p_almacen_id;

  if v_activo is null then
    raise exception 'Almacén no encontrado.';
  end if;
  if not v_activo then
    raise exception 'Un almacén inactivo no puede ser el predeterminado.';
  end if;

  update public.almacenes
     set es_predeterminado = false
   where es_predeterminado and id <> p_almacen_id;

  update public.almacenes
     set es_predeterminado = true
   where id = p_almacen_id;

  return p_almacen_id;
end;
$$;

alter table public.tickets_pesaje
  add column if not exists almacen_id uuid references public.almacenes(id);

create index if not exists idx_tickets_pesaje_almacen
  on public.tickets_pesaje (almacen_id);

-- Reemplaza la RPC (Bloque 30) con exactamente los mismos 10 parámetros —
-- el único cambio es que ahora resuelve el almacén predeterminado ACTIVO del
-- momento y lo guarda en almacen_id. Si no hay ninguno marcado, queda NULL y
-- el ticket no pertenece a ningún almacén (no bloquea el guardado).
create or replace function public.crear_ticket_pesaje(
  p_tipo          text,
  p_entidad_id    uuid,
  p_fecha         date,
  p_fotos         text[],
  p_observaciones text,
  p_materiales    jsonb,
  p_estado        text,
  p_pesado_por    uuid,
  p_peso_global   numeric,
  p_devolucion    numeric default 0
) returns uuid
language plpgsql
as $$
declare
  v_id         uuid;
  v_item       jsonb;
  v_almacen_id uuid;
begin
  select id into v_almacen_id
    from public.almacenes
   where es_predeterminado and activo
   limit 1;

  insert into public.tickets_pesaje
    (tipo, entidad_id, fecha, fotos, observaciones, estado, pesado_por,
     peso_global, devolucion, almacen_id)
  values (
    p_tipo, p_entidad_id, p_fecha, p_fotos, nullif(p_observaciones, ''),
    coalesce(p_estado, 'completo'), p_pesado_por, p_peso_global,
    coalesce(p_devolucion, 0), v_almacen_id
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

-- Stock derivado por almacén. Ahora incluye 4 orígenes:
--   traslados recibidos (+) / enviados (−) — solo completados
--   compras (+) / ventas (−) cuyo ticket apunta a este almacén
-- No se filtra por tickets_pesaje.estado: un ticket en bruto no tiene filas
-- en detalle_tickets_pesaje, así que aporta 0 por construcción. Mantenerlo
-- sin filtro garantiza que este cálculo y el del inventario general sumen
-- sobre exactamente el mismo conjunto de filas.
create or replace function public.stock_almacen(p_almacen_id uuid)
returns table(producto_id uuid, stock numeric)
language sql
stable
as $$
  select producto_id, sum(entrada) - sum(salida) as stock
  from (
    select dt.producto_id, coalesce(dt.peso_recibido, 0) as entrada, 0::numeric as salida
    from public.detalle_traslado dt
    join public.tickets_traslado t on t.id = dt.traslado_id
    where t.almacen_destino_id = p_almacen_id and t.estado = 'completo'
    union all
    select dt.producto_id, 0::numeric, coalesce(dt.peso_neto, 0)
    from public.detalle_traslado dt
    join public.tickets_traslado t on t.id = dt.traslado_id
    where t.almacen_origen_id = p_almacen_id and t.estado = 'completo'
    union all
    select d.producto_id, coalesce(d.peso_neto, 0), 0::numeric
    from public.detalle_tickets_pesaje d
    join public.tickets_pesaje tp on tp.id = d.ticket_id
    where tp.almacen_id = p_almacen_id and tp.tipo = 'compra'
    union all
    select d.producto_id, 0::numeric, coalesce(d.peso_neto, 0)
    from public.detalle_tickets_pesaje d
    join public.tickets_pesaje tp on tp.id = d.ticket_id
    where tp.almacen_id = p_almacen_id and tp.tipo = 'venta'
  ) x
  where producto_id is not null
  group by producto_id;
$$;

-- 34.6 · Backfill histórico → Almacén G2 (decisión de negocio confirmada por
-- Julio, 07-ago-2026). Corrido una sola vez el 07-ago-2026 vía Management
-- API. No es idempotente en el mismo sentido que el resto del bloque (es un
-- UPDATE, no un DDL con IF NOT EXISTS) — se deja documentado como referencia
-- histórica, no para re-ejecutar: si algún ticket queda sin almacen_id en el
-- futuro es porque no había ningún almacén predeterminado activo al crearlo,
-- no porque falte correr esto de nuevo.
--
-- update public.tickets_pesaje
--    set almacen_id = 'c2ce16a1-e832-4f95-8c2a-bfcc9dbb131c'
--  where almacen_id is null;

-- ============================================================================
-- Bloque 35 · Numeración separada por tipo (compra / venta)
--
-- Antes: una sola secuencia (tickets_pesaje_numero_seq) compartida entre
-- compra y venta, mostrada siempre como "Pesaje-000N" sin importar el tipo.
-- Ahora: cada tipo tiene su propia secuencia, arrancando justo después del
-- máximo histórico de SU propio tipo (no se renumera nada existente — un
-- ticket viejo conserva su `numero` de siempre, solo cambia el PREFIJO de
-- texto que ya venía de una función de formato, no de la base de datos:
-- "Pesaje-0014" pasa a leerse "Compra-0014" o "Venta-0014" según corresponda,
-- mismo número, sin tocar ninguna fila).
--
-- El índice único de `numero` pasa de ser global a ser por (tipo, numero) —
-- imprescindible porque de ahora en adelante un ticket de compra y uno de
-- venta SÍ pueden compartir el mismo número (ej. Compra-0020 y Venta-0020
-- coexisten, cada uno en su propia cuenta).
-- ============================================================================

-- 35.1 · Secuencias nuevas, una por tipo, arrancando después del máximo
-- histórico de ese tipo (evita cualquier colisión con datos existentes).
do $$
declare
  v_max_compra integer;
  v_max_venta  integer;
begin
  select coalesce(max(numero), 0) into v_max_compra from public.tickets_pesaje where tipo = 'compra';
  select coalesce(max(numero), 0) into v_max_venta  from public.tickets_pesaje where tipo = 'venta';

  execute format('create sequence if not exists public.tickets_pesaje_numero_compra_seq start with %s', v_max_compra + 1);
  execute format('create sequence if not exists public.tickets_pesaje_numero_venta_seq start with %s', v_max_venta + 1);
end $$;

-- 35.2 · El índice único pasa de (numero) a (tipo, numero).
drop index if exists public.idx_tickets_pesaje_numero;
create unique index if not exists idx_tickets_pesaje_numero
  on public.tickets_pesaje (tipo, numero);

-- 35.3 · crear_ticket_pesaje asigna numero explícitamente según el tipo, en
-- vez de depender del default de columna (que seguía apuntando a la
-- secuencia vieja compartida). Misma firma de 10 parámetros, sin drop.
create or replace function public.crear_ticket_pesaje(
  p_tipo          text,
  p_entidad_id    uuid,
  p_fecha         date,
  p_fotos         text[],
  p_observaciones text,
  p_materiales    jsonb,
  p_estado        text,
  p_pesado_por    uuid,
  p_peso_global   numeric,
  p_devolucion    numeric default 0
) returns uuid
language plpgsql
as $$
declare
  v_id         uuid;
  v_item       jsonb;
  v_almacen_id uuid;
  v_numero     integer;
begin
  select id into v_almacen_id
    from public.almacenes
   where es_predeterminado and activo
   limit 1;

  if p_tipo = 'compra' then
    v_numero := nextval('public.tickets_pesaje_numero_compra_seq');
  else
    v_numero := nextval('public.tickets_pesaje_numero_venta_seq');
  end if;

  insert into public.tickets_pesaje
    (tipo, entidad_id, fecha, fotos, observaciones, estado, pesado_por,
     peso_global, devolucion, almacen_id, numero)
  values (
    p_tipo, p_entidad_id, p_fecha, p_fotos, nullif(p_observaciones, ''),
    coalesce(p_estado, 'completo'), p_pesado_por, p_peso_global,
    coalesce(p_devolucion, 0), v_almacen_id, v_numero
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

-- ============================================================================
-- Bloque 36 · Foto de clientes y proveedores
--
-- Selector visual con imagen en Nueva Factura (mismo patrón que material/tara
-- en Pesaje). Buckets de Storage "clientes" y "proveedores" creados públicos,
-- mismo criterio que "productos"/"taras"/"comprobantes".
-- ============================================================================

alter table public.clientes
  add column if not exists foto_url text;

alter table public.proveedores
  add column if not exists foto_url text;


-- ============================================================================
-- Bloque 37 · Pago combinado a proveedor ("Pagar todo")
--
-- Extiende el pago existente (Bloque 22, registrar_pago_proveedor: 1 pago →
-- máximo 1 factura) para poder liquidar varias facturas y notas de débito
-- pendientes en un solo movimiento de tesorería, más un monto libre de
-- adelanto. Un solo INSERT en movimientos (mismo trigger de saldo del
-- Bloque 2, no hace falta tocarlo) — así queda como "un solo ticket" en el
-- estado de cuenta, con el detalle de qué cubrió en `descripcion` (texto
-- libre armado del lado del frontend).
--
-- Las notas de ajuste ganan `pagada`/`movimiento_id` para poder excluirlas
-- ya liquidadas del selector y dejar rastro de qué pago las cubrió — no
-- reemplaza el mecanismo de anulación del Bloque 28, que sigue siendo la
-- única forma de corregir una nota mal cargada (en finanzas nunca se borra).
-- ============================================================================

alter table public.notas_ajuste_proveedor
  add column if not exists pagada boolean not null default false;

alter table public.notas_ajuste_proveedor
  add column if not exists movimiento_id uuid references public.movimientos(id);

-- RPC atómica: un solo movimiento de egreso por el total, aplicado a N
-- facturas (acumula monto_pagado, misma lógica que registrar_pago_proveedor)
-- y N notas de débito (las marca pagada=true). El monto de cada ítem viene
-- del backend/frontend ya calculado contra el saldo pendiente real de esa
-- factura/nota; la suma de los ítems puede ser menor a p_monto_usd — la
-- diferencia es la porción de adelanto (sin ítem asociado, igual que un pago
-- simple sin factura).
create or replace function public.registrar_pago_proveedor_multiple(
  p_proveedor_id   uuid,
  p_banca_id       uuid,
  p_monto          numeric,   -- en la moneda de la banca de origen
  p_moneda         text,
  p_monto_usd      numeric,   -- equivalente en USD del TOTAL (facturas + notas + adelanto)
  p_descripcion    text,
  p_referencia     text,
  p_fecha          date,
  p_registrado_por uuid,
  p_items          jsonb      -- [{ "tipo": "factura"|"nota_debito", "id": uuid, "montoUsd": numeric }]
) returns uuid
language plpgsql
as $$
declare
  v_mov_id uuid;
  v_item   jsonb;
  v_tipo   text;
  v_id     uuid;
  v_monto  numeric;
  v_total  numeric;
  v_pagado numeric;
  v_filas  int;
begin
  insert into public.movimientos
    (tipo, monto, moneda, monto_usd, descripcion, banca_origen_id, banca_destino_id,
     fecha, referencia, registrado_por, proveedor_id)
  values
    ('egreso', p_monto, p_moneda, p_monto_usd, nullif(p_descripcion, ''), p_banca_id, null,
     p_fecha, nullif(p_referencia, ''), p_registrado_por, p_proveedor_id)
  returning id into v_mov_id;

  for v_item in select value from jsonb_array_elements(p_items) as elems(value)
  loop
    v_tipo  := v_item->>'tipo';
    v_id    := (v_item->>'id')::uuid;
    v_monto := (v_item->>'montoUsd')::numeric;

    if v_tipo = 'factura' then
      select total, monto_pagado into v_total, v_pagado
        from public.facturas_compra where id = v_id and proveedor_id = p_proveedor_id;

      if v_total is null then
        raise exception 'Factura % no encontrada para este proveedor.', v_id;
      end if;

      v_pagado := coalesce(v_pagado, 0) + v_monto;

      update public.facturas_compra
         set monto_pagado = v_pagado,
             estado = case when v_pagado >= v_total - 0.01 then 'pagada' else estado end
       where id = v_id;

    elsif v_tipo = 'nota_debito' then
      update public.notas_ajuste_proveedor
         set pagada = true,
             movimiento_id = v_mov_id
       where id = v_id
         and proveedor_id = p_proveedor_id
         and tipo = 'debito'
         and anulada = false
         and pagada = false;

      get diagnostics v_filas = row_count;
      if v_filas = 0 then
        raise exception 'Nota de débito % no encontrada, ya pagada o anulada.', v_id;
      end if;

    else
      raise exception 'Tipo de ítem desconocido: %', v_tipo;
    end if;
  end loop;

  return v_mov_id;
end;
$$;

-- Redefinición de anular_nota_ajuste_proveedor (Bloque 28) para bloquear la
-- anulación de una nota ya pagada con dinero real: anularla dejaría un
-- movimiento de tesorería real respaldado por una nota que ya no "existe"
-- contablemente. Para corregir una nota pagada por error, hay que reversar
-- primero el pago (fuera de alcance de esta RPC).
create or replace function public.anular_nota_ajuste_proveedor(
  p_nota_id        uuid,
  p_motivo         text,
  p_registrado_por uuid
) returns uuid
language plpgsql
as $$
declare
  v_proveedor_id uuid;
  v_tipo         text;
  v_monto        numeric;
  v_anulada      boolean;
  v_pagada       boolean;
  v_nueva_id     uuid;
begin
  select proveedor_id, tipo, monto, anulada, pagada
    into v_proveedor_id, v_tipo, v_monto, v_anulada, v_pagada
    from public.notas_ajuste_proveedor
   where id = p_nota_id;

  if v_proveedor_id is null then
    raise exception 'Nota no encontrada.';
  end if;
  if v_anulada then
    raise exception 'Esta nota ya fue anulada.';
  end if;
  if v_pagada then
    raise exception 'Esta nota ya fue pagada — no se puede anular sin reversar antes el pago.';
  end if;

  insert into public.notas_ajuste_proveedor
    (proveedor_id, tipo, monto, motivo, anula_nota_id, registrado_por)
  values (
    v_proveedor_id,
    case when v_tipo = 'credito' then 'debito' else 'credito' end,
    v_monto,
    p_motivo,
    p_nota_id,
    p_registrado_por
  )
  returning id into v_nueva_id;

  update public.notas_ajuste_proveedor set anulada = true where id = p_nota_id;

  return v_nueva_id;
end;
$$;


-- ============================================================================
-- Bloque 38 · correlativos de pagos, adelantos y notas de ajuste
--
-- Pagos, adelantos y notas de crédito/débito no tenían ningún identificador
-- visible al usuario (solo el uuid interno). Se agregan 4 correlativos
-- independientes (PG-/AD-/NC-/ND-), mismo patrón de los Bloques 14/15/29
-- (secuencia nativa + columna `numero` + backfill), con dos diferencias:
--
--   1. `movimientos` es una tabla compartida por Cochinito (ingresos, egresos
--      y transferencias genéricas) y por pagos a proveedor — el correlativo
--      solo aplica a estos últimos, así que se agrega `subtipo` para
--      distinguir 'pago' de 'adelanto' dentro de los egresos con proveedor.
--      Queda NULL en cualquier movimiento que no sea uno de los dos.
--   2. Como `subtipo` decide CUÁL de las dos secuencias usar, un DEFAULT de
--      columna no alcanza (no puede mirar otra columna) — se resuelve con un
--      trigger BEFORE INSERT que además respeta un `numero` ya provisto, lo
--      que permite que un pago partido entre varias bancas (Bloque 39)
--      comparta un solo correlativo entre sus filas.
--
-- `grupo_id` agrupa las filas de una misma operación (un pago con adelanto
-- y/o repartido entre bancas genera varias filas de movimientos) para que el
-- estado de cuenta las muestre como una sola línea por documento.
--
-- Históricos: todo egreso ya ligado a un proveedor se etiqueta 'pago' (hoy no
-- hay forma de distinguir retroactivamente cuáles eran adelanto sin factura
-- asociada — la diferencia se perdía en el total combinado del Bloque 37) y
-- se numera por fecha de creación, así ninguna fila del estado de cuenta
-- queda con referencia vacía.
-- ============================================================================

-- --- movimientos: subtipo + numero + grupo_id -------------------------------

alter table public.movimientos
  add column if not exists subtipo text;

alter table public.movimientos drop constraint if exists movimientos_subtipo_check;
alter table public.movimientos
  add constraint movimientos_subtipo_check
  check (subtipo is null or subtipo in ('pago', 'adelanto'));

alter table public.movimientos
  add column if not exists numero bigint;

alter table public.movimientos
  add column if not exists grupo_id uuid;

update public.movimientos
set subtipo = 'pago'
where subtipo is null
  and tipo = 'egreso'
  and proveedor_id is not null;

create sequence if not exists public.movimientos_pago_numero_seq;
create sequence if not exists public.movimientos_adelanto_numero_seq;

update public.movimientos m
set numero = o.rn
from (
  select id, row_number() over (order by creado_en, id) as rn
  from public.movimientos
  where subtipo = 'pago' and numero is null
) o
where m.id = o.id;

select setval(
  'public.movimientos_pago_numero_seq',
  coalesce((select max(numero) from public.movimientos where subtipo = 'pago'), 0) + 1,
  false
);
-- La secuencia de adelanto arranca en 1: no hay históricos identificables
-- como tales (ver nota de históricos arriba).

-- No único: un pago partido entre varias bancas genera varias filas que
-- comparten a propósito el mismo (subtipo, numero) — es el correlativo de
-- la OPERACIÓN, no de la fila.
create index if not exists idx_movimientos_subtipo_numero
  on public.movimientos (subtipo, numero)
  where subtipo is not null;

create index if not exists idx_movimientos_grupo
  on public.movimientos (grupo_id)
  where grupo_id is not null;

create or replace function public.asignar_correlativo_movimiento()
returns trigger
language plpgsql
as $$
begin
  if new.numero is null then
    if new.subtipo = 'pago' then
      new.numero := nextval('public.movimientos_pago_numero_seq');
    elsif new.subtipo = 'adelanto' then
      new.numero := nextval('public.movimientos_adelanto_numero_seq');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_asignar_correlativo_movimiento on public.movimientos;

create trigger trg_asignar_correlativo_movimiento
before insert on public.movimientos
for each row
execute function public.asignar_correlativo_movimiento();

-- --- notas_ajuste_proveedor: numero -----------------------------------------

alter table public.notas_ajuste_proveedor
  add column if not exists numero bigint;

create sequence if not exists public.notas_credito_numero_seq;
create sequence if not exists public.notas_debito_numero_seq;

update public.notas_ajuste_proveedor n
set numero = o.rn
from (
  select id, row_number() over (partition by tipo order by created_at, id) as rn
  from public.notas_ajuste_proveedor
  where numero is null
) o
where n.id = o.id;

select setval(
  'public.notas_credito_numero_seq',
  coalesce((select max(numero) from public.notas_ajuste_proveedor where tipo = 'credito'), 0) + 1,
  false
);
select setval(
  'public.notas_debito_numero_seq',
  coalesce((select max(numero) from public.notas_ajuste_proveedor where tipo = 'debito'), 0) + 1,
  false
);

alter table public.notas_ajuste_proveedor
  alter column numero set not null;

-- Único: 1 fila de nota = 1 documento (a diferencia de movimientos, acá no
-- hay reparto entre varias filas).
create unique index if not exists idx_notas_ajuste_proveedor_tipo_numero
  on public.notas_ajuste_proveedor (tipo, numero);

create or replace function public.asignar_correlativo_nota_ajuste()
returns trigger
language plpgsql
as $$
begin
  if new.numero is null then
    if new.tipo = 'credito' then
      new.numero := nextval('public.notas_credito_numero_seq');
    elsif new.tipo = 'debito' then
      new.numero := nextval('public.notas_debito_numero_seq');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_asignar_correlativo_nota_ajuste on public.notas_ajuste_proveedor;

create trigger trg_asignar_correlativo_nota_ajuste
before insert on public.notas_ajuste_proveedor
for each row
execute function public.asignar_correlativo_nota_ajuste();


-- ============================================================================
-- Bloque 39 · pago simple con validación de saldo + pago multi-banca con
-- adelanto separado (extiende Bloques 22 y 37)
--
-- registrar_pago_proveedor (simple, misma firma): ahora bloquea la banca con
-- `for update` antes de descontar y lanza excepción si el saldo no alcanza
-- (antes solo se validaba en el frontend contra el saldo leído al abrir el
-- modal — condición de carrera real entre dos pagos concurrentes). También
-- etiqueta el movimiento con `subtipo` ('adelanto' si no viene ligado a
-- factura, 'pago' si sí) para que reciba su correlativo del Bloque 38.
--
-- registrar_pago_proveedor_multi_banca (nueva, no reemplaza a
-- registrar_pago_proveedor_multiple del Bloque 37 — esa se deja viva y se
-- dropea en un bloque aparte una vez el deploy esté verde, para no romper
-- el código en producción mientras se despliega el nuevo):
--   - Recibe un array de bancas en vez de una sola (reparto multi-cuenta).
--   - El total ya no se deriva de los ítems: `p_monto_usd` es lo que el
--     usuario escribió en "Total a pagar". Si supera la suma de los ítems
--     seleccionados, el excedente es un adelanto y se registra en una fila
--     de movimiento APARTE (subtipo 'adelanto', su propio correlativo AD-),
--     en vez de mezclarse en el mismo movimiento del pago (a diferencia del
--     Bloque 37 original).
--   - Si una banca cae "a caballo" entre cubrir pago y adelanto, su aporte
--     se parte en dos filas (mismo banca_origen_id, subtipo distinto),
--     prorrateando el monto en moneda local sin perder centavos (el
--     residuo exacto va a la segunda fila) — el trigger de saldo del
--     Bloque 2 debita por fila, así que la suma debitada de esa banca sigue
--     siendo exactamente lo que el usuario indicó.
--   - Todas las filas de una misma operación comparten `grupo_id` para que
--     el estado de cuenta las muestre agrupadas por documento.
-- ============================================================================

create or replace function public.registrar_pago_proveedor(
  p_proveedor_id   uuid,
  p_banca_id       uuid,
  p_monto          numeric,
  p_moneda         text,
  p_monto_usd      numeric,
  p_descripcion    text,
  p_referencia     text,
  p_fecha          date,
  p_registrado_por uuid,
  p_factura_id     uuid
) returns uuid
language plpgsql
as $$
declare
  v_mov_id   uuid;
  v_total    numeric;
  v_pagado   numeric;
  v_saldo    numeric;
  v_nombre   text;
  v_archivada boolean;
  v_subtipo  text;
begin
  select saldo, nombre, archivada into v_saldo, v_nombre, v_archivada
    from public.bancas where id = p_banca_id
    for update;

  if v_saldo is null then
    raise exception 'Banca no encontrada.';
  end if;
  if v_archivada then
    raise exception 'La banca % está archivada.', v_nombre;
  end if;
  if p_monto > v_saldo + 0.01 then
    raise exception 'Saldo insuficiente en %: disponible %, requerido %', v_nombre, v_saldo, p_monto;
  end if;

  v_subtipo := case when p_factura_id is null then 'adelanto' else 'pago' end;

  insert into public.movimientos
    (tipo, subtipo, monto, moneda, monto_usd, descripcion, banca_origen_id, banca_destino_id,
     fecha, referencia, registrado_por, proveedor_id)
  values
    ('egreso', v_subtipo, p_monto, p_moneda, p_monto_usd, nullif(p_descripcion, ''), p_banca_id, null,
     p_fecha, nullif(p_referencia, ''), p_registrado_por, p_proveedor_id)
  returning id into v_mov_id;

  if p_factura_id is not null then
    select total, monto_pagado into v_total, v_pagado
      from public.facturas_compra where id = p_factura_id;

    if v_total is null then
      raise exception 'Factura no encontrada.';
    end if;

    v_pagado := coalesce(v_pagado, 0) + p_monto_usd;

    update public.facturas_compra
       set monto_pagado = v_pagado,
           estado = case when v_pagado >= v_total - 0.01 then 'pagada' else estado end
     where id = p_factura_id;
  end if;

  return v_mov_id;
end;
$$;

create or replace function public.registrar_pago_proveedor_multi_banca(
  p_proveedor_id   uuid,
  p_bancas         jsonb,     -- [{ "bancaId": uuid, "monto": numeric, "montoUsd": numeric, "moneda": "USD"|"VES", "referencia": text|null }]
  p_monto_usd      numeric,   -- total declarado por el usuario ("Total a pagar")
  p_descripcion    text,
  p_referencia     text,
  p_fecha          date,
  p_registrado_por uuid,
  p_items          jsonb      -- [{ "tipo": "factura"|"nota_debito", "id": uuid, "montoUsd": numeric }]
) returns jsonb
language plpgsql
as $$
declare
  v_item              jsonb;
  v_banca             jsonb;
  v_tipo               text;
  v_id                 uuid;
  v_monto              numeric;
  v_total              numeric;
  v_pagado             numeric;
  v_filas              int;
  v_total_items        numeric;
  v_total_bancas       numeric;
  v_adelanto           numeric;
  v_saldo              numeric;
  v_nombre             text;
  v_archivada          boolean;
  v_num_pago           bigint;
  v_num_adel           bigint;
  v_grupo_id           uuid;
  v_restante_pago      numeric;
  v_banca_id           uuid;
  v_banca_monto        numeric;
  v_banca_monto_usd    numeric;
  v_banca_moneda       text;
  v_banca_referencia   text;
  v_ap_pago_usd        numeric;
  v_ap_adel_usd        numeric;
  v_monto_pago         numeric;
  v_monto_adel         numeric;
  v_mov_id             uuid;
  v_mov_pago_principal uuid;
  v_mov_adel_principal uuid;
  v_ids                uuid[] := '{}';
begin
  if p_bancas is null or jsonb_typeof(p_bancas) <> 'array' or jsonb_array_length(p_bancas) = 0 then
    raise exception 'Debe indicar al menos una banca de origen.';
  end if;

  if (select count(*) from jsonb_array_elements(p_bancas)) <>
     (select count(distinct (value->>'bancaId')) from jsonb_array_elements(p_bancas)) then
    raise exception 'No se puede repetir la misma banca en un pago.';
  end if;

  select coalesce(sum((value->>'montoUsd')::numeric), 0) into v_total_items
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as elems(value);

  select coalesce(sum((value->>'montoUsd')::numeric), 0) into v_total_bancas
    from jsonb_array_elements(p_bancas) as elems(value);

  if abs(v_total_bancas - p_monto_usd) > 0.01 then
    raise exception 'La suma de las bancas (%) no coincide con el total a pagar (%).', v_total_bancas, p_monto_usd;
  end if;

  v_adelanto := round(p_monto_usd - v_total_items, 2);
  if v_adelanto < -0.01 then
    raise exception 'El total a pagar (%) es menor a la suma de lo seleccionado (%).', p_monto_usd, v_total_items;
  end if;
  if abs(v_adelanto) <= 0.01 then
    v_adelanto := 0;
  end if;

  -- Bloquea todas las bancas involucradas en orden estable (por id) antes de
  -- tocar ninguna, para no generar deadlocks con otro pago concurrente que
  -- use el mismo conjunto de bancas en distinto orden.
  for v_banca in
    select value from jsonb_array_elements(p_bancas) as elems(value)
    order by (value->>'bancaId')
  loop
    select saldo, nombre, archivada into v_saldo, v_nombre, v_archivada
      from public.bancas where id = (v_banca->>'bancaId')::uuid
      for update;

    if v_saldo is null then
      raise exception 'Banca % no encontrada.', v_banca->>'bancaId';
    end if;
    if v_archivada then
      raise exception 'La banca % está archivada.', v_nombre;
    end if;
    if (v_banca->>'monto')::numeric > v_saldo + 0.01 then
      raise exception 'Saldo insuficiente en %: disponible %, requerido %',
        v_nombre, v_saldo, (v_banca->>'monto')::numeric;
    end if;
  end loop;

  v_grupo_id := gen_random_uuid();
  if v_total_items > 0 then
    v_num_pago := nextval('public.movimientos_pago_numero_seq');
  end if;
  if v_adelanto > 0 then
    v_num_adel := nextval('public.movimientos_adelanto_numero_seq');
  end if;

  -- Reparte cada banca entre pago/adelanto en el orden en que el usuario las
  -- cargó (no el orden de bloqueo de arriba, que es solo para evitar
  -- deadlocks): llena primero el pago hasta agotar v_total_items, el resto
  -- de cada banca es adelanto.
  v_restante_pago := v_total_items;

  for v_banca in select value from jsonb_array_elements(p_bancas) as elems(value)
  loop
    v_banca_id := (v_banca->>'bancaId')::uuid;
    v_banca_monto := (v_banca->>'monto')::numeric;
    v_banca_monto_usd := (v_banca->>'montoUsd')::numeric;
    v_banca_moneda := v_banca->>'moneda';
    -- Referencia propia de esta banca; si viene vacía, cae a la referencia
    -- global del pago (compatibilidad con llamadas que no manden por línea).
    v_banca_referencia := coalesce(nullif(v_banca->>'referencia', ''), nullif(p_referencia, ''));

    if v_banca_monto_usd <= 0 then
      continue;
    end if;

    v_ap_pago_usd := least(v_banca_monto_usd, v_restante_pago);
    v_ap_adel_usd := v_banca_monto_usd - v_ap_pago_usd;
    v_restante_pago := v_restante_pago - v_ap_pago_usd;
    v_monto_pago := 0;

    if v_ap_pago_usd > 0.01 then
      v_monto_pago := round(v_banca_monto * v_ap_pago_usd / v_banca_monto_usd, 2);

      insert into public.movimientos
        (tipo, subtipo, numero, grupo_id, monto, moneda, monto_usd, descripcion,
         banca_origen_id, banca_destino_id, fecha, referencia, registrado_por, proveedor_id)
      values
        ('egreso', 'pago', v_num_pago, v_grupo_id, v_monto_pago, v_banca_moneda, v_ap_pago_usd,
         nullif(p_descripcion, ''), v_banca_id, null, p_fecha, v_banca_referencia,
         p_registrado_por, p_proveedor_id)
      returning id into v_mov_id;

      v_ids := v_ids || v_mov_id;
      if v_mov_pago_principal is null then v_mov_pago_principal := v_mov_id; end if;
    end if;

    if v_ap_adel_usd > 0.01 then
      -- Residuo exacto del monto en moneda local (no se recalcula por
      -- separado) para que la suma pago+adelanto de esta banca sea
      -- exactamente v_banca_monto, sin drift de centavos.
      v_monto_adel := v_banca_monto - v_monto_pago;

      insert into public.movimientos
        (tipo, subtipo, numero, grupo_id, monto, moneda, monto_usd, descripcion,
         banca_origen_id, banca_destino_id, fecha, referencia, registrado_por, proveedor_id)
      values
        ('egreso', 'adelanto', v_num_adel, v_grupo_id, v_monto_adel, v_banca_moneda, v_ap_adel_usd,
         nullif(case when v_total_items > 0 then 'Adelanto' else p_descripcion end, ''),
         v_banca_id, null, p_fecha, v_banca_referencia, p_registrado_por, p_proveedor_id)
      returning id into v_mov_id;

      v_ids := v_ids || v_mov_id;
      if v_mov_adel_principal is null then v_mov_adel_principal := v_mov_id; end if;
    end if;
  end loop;

  -- Aplica los ítems (misma lógica que registrar_pago_proveedor_multiple del
  -- Bloque 37): factura acumula monto_pagado, nota_debito se marca pagada,
  -- ligada a la fila principal del pago (no a la del adelanto).
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as elems(value)
  loop
    v_tipo  := v_item->>'tipo';
    v_id    := (v_item->>'id')::uuid;
    v_monto := (v_item->>'montoUsd')::numeric;

    if v_tipo = 'factura' then
      select total, monto_pagado into v_total, v_pagado
        from public.facturas_compra where id = v_id and proveedor_id = p_proveedor_id;

      if v_total is null then
        raise exception 'Factura % no encontrada para este proveedor.', v_id;
      end if;

      v_pagado := coalesce(v_pagado, 0) + v_monto;

      update public.facturas_compra
         set monto_pagado = v_pagado,
             estado = case when v_pagado >= v_total - 0.01 then 'pagada' else estado end
       where id = v_id;

    elsif v_tipo = 'nota_debito' then
      update public.notas_ajuste_proveedor
         set pagada = true,
             movimiento_id = v_mov_pago_principal
       where id = v_id
         and proveedor_id = p_proveedor_id
         and tipo = 'debito'
         and anulada = false
         and pagada = false;

      get diagnostics v_filas = row_count;
      if v_filas = 0 then
        raise exception 'Nota de débito % no encontrada, ya pagada o anulada.', v_id;
      end if;

    else
      raise exception 'Tipo de ítem desconocido: %', v_tipo;
    end if;
  end loop;

  return jsonb_build_object(
    'movimientoPrincipalId', coalesce(v_mov_pago_principal, v_mov_adel_principal),
    'movimientoIds', to_jsonb(v_ids),
    'grupoId', v_grupo_id,
    'numeroPago', v_num_pago,
    'numeroAdelanto', v_num_adel
  );
end;
$$;

-- Nota de despliegue: registrar_pago_proveedor_multiple (Bloque 37) se deja
-- viva a propósito — el backend en producción sigue llamándola hasta que el
-- deploy que usa registrar_pago_proveedor_multi_banca esté verificado en el
-- preview y mergeado a main. Recién ahí correr, en una migración aparte:
--   drop function if exists public.registrar_pago_proveedor_multiple(
--     uuid, uuid, numeric, text, numeric, text, text, date, uuid, jsonb
--   );


-- ============================================================================
-- Bloque 40 · Rediseño completo de Transformaciones (Fase 1 — flujo físico)
--
-- Reemplaza por completo las tablas `transformaciones`/`detalle_transformaciones`
-- del Bloque 7 y la RPC `crear_transformacion` del Bloque 12 (0 filas en
-- producción al momento de este cambio, sin datos que migrar). El modelo
-- viejo (1 material entra → N materiales salen, sin lote, sin pesaje real, sin
-- estado) no reflejaba el proceso real de planta: una transformación retira
-- kilos de un lote-pool de mezcla (MPP, BGPP — ya son lotes reales, no el
-- sentinela `destino_tipo='mpp'`, ver Bloque de pesaje) y produce salidas
-- pesadas hacia otros lotes (Lote1, Lote2, incluso "Basura" — es un lote más).
--
-- Costeo del pool de entrada: promedio ponderado — al retirar X kg de un pool
-- mezclado no se sabe qué producto original salió, se reparte proporcional a
-- la composición actual del pool (transformacion_entrada_detalle, snapshot
-- persistido porque la composición sigue cambiando con el tiempo).
--
-- Decisión de diseño: sin tabla de saldo/ledger + trigger (como bancas.saldo).
-- `editar_ticket_pesaje` borra y reinserta filas de detalle_tickets_pesaje —
-- un trigger AFTER INSERT simple no lo revertiría bien (riesgo de doble
-- conteo). Se usa el patrón ya existente de stock derivado por consulta
-- (mismo estilo que stock_almacen()): stock_lote_por_producto() y
-- stock_lote_total().
--
-- Fuera de esta fase (deliberado, a futuro): matriz de rendimiento
-- producto→lote_destino, precio de referencia por lote (valorización NRV),
-- márgenes de la transformación, y la pestaña "Exportaciones".
-- ============================================================================

drop function if exists public.crear_transformacion(uuid, numeric, text, date, jsonb);
drop table if exists public.detalle_transformaciones;
drop table if exists public.transformaciones;

create table public.transformaciones (
  id                uuid        primary key default gen_random_uuid(),
  lote_origen_id    uuid        not null references public.lotes(id),
  peso_bruto        numeric     not null,
  tara              numeric     not null default 0,
  peso_neto         numeric     generated always as (peso_bruto - tara) stored,
  fecha             date        not null,
  estado            text        not null default 'bruto' check (estado in ('bruto', 'completa')),
  notas             text,
  registrado_por    uuid        references public.users(id),
  completado_por    uuid        references public.users(id),
  completado_en     timestamptz,
  created_at        timestamptz not null default now(),
  check (peso_bruto > tara)
);

alter table public.transformaciones disable row level security;

create index idx_transformaciones_fecha on public.transformaciones (fecha desc);
create index idx_transformaciones_lote_origen on public.transformaciones (lote_origen_id);
create index idx_transformaciones_estado on public.transformaciones (estado);

-- Snapshot persistido del reparto proporcional del pool en el momento del
-- retiro (composición por promedio ponderado). No se puede recalcular
-- después porque la composición del pool sigue cambiando con el tiempo.
create table public.transformacion_entrada_detalle (
  id                uuid    primary key default gen_random_uuid(),
  transformacion_id uuid    not null references public.transformaciones(id) on delete cascade,
  producto_id       uuid    not null references public.productos(id),
  peso_kg           numeric not null check (peso_kg > 0)
);

alter table public.transformacion_entrada_detalle disable row level security;

create index idx_transf_entrada_detalle_transformacion on public.transformacion_entrada_detalle (transformacion_id);
create index idx_transf_entrada_detalle_producto on public.transformacion_entrada_detalle (producto_id);

-- Salidas reales pesadas. Sin producto_id a propósito: al pesar la salida no
-- se puede saber con certeza qué producto original representa cada kilo (es
-- justo el problema de la mezcla que se está resolviendo). Un lote
-- alimentado por transformaciones no tiene desglose por producto, solo total
-- en kg — ver stock_lote_total().
create table public.transformacion_salida_detalle (
  id                uuid        primary key default gen_random_uuid(),
  transformacion_id uuid        not null references public.transformaciones(id) on delete cascade,
  lote_destino_id   uuid        not null references public.lotes(id),
  peso_bruto        numeric     not null,
  tara              numeric     not null default 0,
  peso_neto         numeric     generated always as (peso_bruto - tara) stored,
  created_at        timestamptz not null default now(),
  check (peso_bruto > tara)
);

alter table public.transformacion_salida_detalle disable row level security;

create index idx_transf_salida_detalle_transformacion on public.transformacion_salida_detalle (transformacion_id);
create index idx_transf_salida_detalle_lote_destino on public.transformacion_salida_detalle (lote_destino_id);

-- Composición conocida por producto de un lote-pool (MPP, BGPP, o cualquier
-- lote que reciba material directo de compra): compras directas (+), ventas
-- directas (−), retiros de transformaciones que lo usaron como origen (−).
-- Es la base para repartir un nuevo retiro por promedio ponderado. Mismo
-- estilo que stock_almacen(): UNION ALL de fuentes con entrada/salida,
-- agrupado al final.
create or replace function public.stock_lote_por_producto(p_lote_id uuid)
returns table(producto_id uuid, stock numeric)
language sql
stable
as $$
  select producto_id, sum(entrada) - sum(salida) as stock
  from (
    select d.producto_id, coalesce(d.peso_neto, 0) as entrada, 0::numeric as salida
    from public.detalle_tickets_pesaje d
    join public.tickets_pesaje tp on tp.id = d.ticket_id
    where d.destino_tipo = 'lote' and d.lote_id = p_lote_id and tp.tipo = 'compra'
    union all
    select d.producto_id, 0::numeric, coalesce(d.peso_neto, 0)
    from public.detalle_tickets_pesaje d
    join public.tickets_pesaje tp on tp.id = d.ticket_id
    where d.destino_tipo = 'lote' and d.lote_id = p_lote_id and tp.tipo = 'venta'
    union all
    select ted.producto_id, 0::numeric, coalesce(ted.peso_kg, 0)
    from public.transformacion_entrada_detalle ted
    join public.transformaciones t on t.id = ted.transformacion_id
    where t.lote_origen_id = p_lote_id
  ) x
  where producto_id is not null
  group by producto_id;
$$;

-- Kg totales reales en un lote ahora mismo: la parte conocida por producto
-- (arriba) más los kg que entraron como salida de transformaciones (esos no
-- tienen producto_id, se suman aparte). Es lo que se muestra en UI para
-- "cuánto hay en este lote". NOTA: crear_transformacion() NO usa esta
-- función como tope de retiro — usa solo stock_lote_por_producto(), porque
-- ese es el único monto que se puede repartir por producto de forma
-- confiable (si un pool recibió kg de otra transformación en cascada, esa
-- porción no tiene producto asociado y no se puede repartir — límite conocido
-- de esta fase, no se resuelve aquí porque el cliente no describió cascadas
-- pool→pool en su proceso real).
create or replace function public.stock_lote_total(p_lote_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce((select sum(stock) from public.stock_lote_por_producto(p_lote_id)), 0)
       + coalesce((
           select sum(tsd.peso_neto)
           from public.transformacion_salida_detalle tsd
           where tsd.lote_destino_id = p_lote_id
         ), 0);
$$;

-- Retira peso_neto de un lote-pool y lo reparte por promedio ponderado entre
-- los productos que hoy lo componen (stock_lote_por_producto). Bloquea el
-- lote origen para serializar transformaciones concurrentes sobre el mismo
-- pool — un solo lote, nunca dos, así que no hace falta el orden estable que
-- sí usa registrar_pago_proveedor_multi_banca.
create or replace function public.crear_transformacion(
  p_lote_origen_id uuid,
  p_peso_bruto     numeric,
  p_tara           numeric,
  p_fecha          date,
  p_notas          text,
  p_registrado_por uuid
) returns uuid
language plpgsql
as $$
declare
  v_id              uuid;
  v_neto            numeric;
  v_total_conocido  numeric;
  v_prod            record;
  v_nombre_lote     text;
begin
  select nombre into v_nombre_lote from public.lotes where id = p_lote_origen_id for update;
  if v_nombre_lote is null then
    raise exception 'Lote origen % no encontrado.', p_lote_origen_id;
  end if;

  v_neto := coalesce(p_peso_bruto, 0) - coalesce(p_tara, 0);
  if v_neto <= 0 then
    raise exception 'El peso neto debe ser mayor a 0.';
  end if;

  select coalesce(sum(stock), 0) into v_total_conocido
    from public.stock_lote_por_producto(p_lote_origen_id)
   where stock > 0;

  if v_neto > v_total_conocido + 0.01 then
    raise exception 'Solo hay % kg disponibles en %.', round(v_total_conocido, 2), v_nombre_lote;
  end if;

  insert into public.transformaciones
    (lote_origen_id, peso_bruto, tara, fecha, estado, notas, registrado_por)
  values
    (p_lote_origen_id, p_peso_bruto, coalesce(p_tara, 0), coalesce(p_fecha, current_date),
     'bruto', nullif(p_notas, ''), p_registrado_por)
  returning id into v_id;

  if v_total_conocido > 0 then
    for v_prod in
      select producto_id, stock from public.stock_lote_por_producto(p_lote_origen_id) where stock > 0
    loop
      insert into public.transformacion_entrada_detalle (transformacion_id, producto_id, peso_kg)
      values (v_id, v_prod.producto_id, round(v_neto * v_prod.stock / v_total_conocido, 4));
    end loop;
  end if;

  return v_id;
end;
$$;

-- Completa una transformación 'bruto' con sus salidas reales pesadas.
-- Permite merma (suma de salidas < entrada) pero no ganancia de masa.
create or replace function public.completar_transformacion(
  p_transformacion_id uuid,
  p_salidas           jsonb,   -- [{ "lote_destino_id": uuid, "peso_bruto": numeric, "tara": numeric }, ...]
  p_completado_por    uuid
) returns uuid
language plpgsql
as $$
declare
  v_estado             text;
  v_lote_origen_id     uuid;
  v_peso_neto_entrada  numeric;
  v_item               jsonb;
  v_suma_salidas       numeric := 0;
  v_peso_bruto         numeric;
  v_tara               numeric;
  v_neto               numeric;
  v_lote_destino       uuid;
begin
  select estado, lote_origen_id, peso_neto
    into v_estado, v_lote_origen_id, v_peso_neto_entrada
    from public.transformaciones
   where id = p_transformacion_id
     for update;

  if v_estado is null then
    raise exception 'Transformación % no encontrada.', p_transformacion_id;
  end if;
  if v_estado <> 'bruto' then
    raise exception 'Esta transformación ya fue completada.';
  end if;

  if p_salidas is null or jsonb_typeof(p_salidas) <> 'array' or jsonb_array_length(p_salidas) = 0 then
    raise exception 'Debe indicar al menos una salida.';
  end if;

  for v_item in select value from jsonb_array_elements(p_salidas) as elems(value)
  loop
    v_lote_destino := (v_item->>'lote_destino_id')::uuid;
    v_peso_bruto := (v_item->>'peso_bruto')::numeric;
    v_tara := coalesce((v_item->>'tara')::numeric, 0);
    v_neto := v_peso_bruto - v_tara;

    if v_lote_destino = v_lote_origen_id then
      raise exception 'El lote destino debe ser distinto del lote origen.';
    end if;
    if v_neto <= 0 then
      raise exception 'El peso neto de cada salida debe ser mayor a 0.';
    end if;
    if not exists (select 1 from public.lotes where id = v_lote_destino and activo) then
      raise exception 'Lote destino % no encontrado o archivado.', v_lote_destino;
    end if;

    v_suma_salidas := v_suma_salidas + v_neto;
  end loop;

  if v_suma_salidas > v_peso_neto_entrada + 0.01 then
    raise exception 'La suma de las salidas (%) supera el peso neto de entrada (%).',
      round(v_suma_salidas, 2), round(v_peso_neto_entrada, 2);
  end if;

  for v_item in select value from jsonb_array_elements(p_salidas) as elems(value)
  loop
    insert into public.transformacion_salida_detalle (transformacion_id, lote_destino_id, peso_bruto, tara)
    values (
      p_transformacion_id,
      (v_item->>'lote_destino_id')::uuid,
      (v_item->>'peso_bruto')::numeric,
      coalesce((v_item->>'tara')::numeric, 0)
    );
  end loop;

  update public.transformaciones
     set estado = 'completa', completado_por = p_completado_por, completado_en = now()
   where id = p_transformacion_id;

  return p_transformacion_id;
end;
$$;


-- ============================================================================
-- Bloque 41 · nota de crédito/débito asociada a una factura de compra
--
-- Las notas de crédito/débito de un proveedor podían usarse solo como ajuste
-- general de saldo (Bloque 28). Se agrega la posibilidad de asociarlas a una
-- factura de compra puntual, para dejar trazado a qué documento corrige el
-- ajuste (ej. descuento de flete de una factura específica). Sigue siendo
-- OPCIONAL — las notas también se usan sin factura de por medio (decisión
-- confirmada por el negocio), y se puede asociar a una factura ya pagada
-- (no se bloquea ese caso).
-- ============================================================================

alter table public.notas_ajuste_proveedor
  add column if not exists factura_id uuid references public.facturas_compra(id);

create index if not exists idx_notas_ajuste_proveedor_factura
  on public.notas_ajuste_proveedor (factura_id);

-- Redefinición de anular_nota_ajuste_proveedor (última definida en el Bloque
-- 37) para que la nota contraria que genera la anulación copie también
-- factura_id de la nota original. Si no se hiciera, al anular una nota
-- asociada a una factura la reversa quedaría huérfana de esa relación —el
-- Estado de Cuenta mostraría la nota original con su factura pero la
-- contraria sin ninguna, rompiendo la trazabilidad que este bloque agrega.
create or replace function public.anular_nota_ajuste_proveedor(
  p_nota_id        uuid,
  p_motivo         text,
  p_registrado_por uuid
) returns uuid
language plpgsql
as $$
declare
  v_proveedor_id uuid;
  v_tipo         text;
  v_monto        numeric;
  v_anulada      boolean;
  v_pagada       boolean;
  v_factura_id   uuid;
  v_nueva_id     uuid;
begin
  select proveedor_id, tipo, monto, anulada, pagada, factura_id
    into v_proveedor_id, v_tipo, v_monto, v_anulada, v_pagada, v_factura_id
    from public.notas_ajuste_proveedor
   where id = p_nota_id;

  if v_proveedor_id is null then
    raise exception 'Nota no encontrada.';
  end if;
  if v_anulada then
    raise exception 'Esta nota ya fue anulada.';
  end if;
  if v_pagada then
    raise exception 'Esta nota ya fue pagada — no se puede anular sin reversar antes el pago.';
  end if;

  insert into public.notas_ajuste_proveedor
    (proveedor_id, tipo, monto, motivo, anula_nota_id, registrado_por, factura_id)
  values (
    v_proveedor_id,
    case when v_tipo = 'credito' then 'debito' else 'credito' end,
    v_monto,
    p_motivo,
    p_nota_id,
    p_registrado_por,
    v_factura_id
  )
  returning id into v_nueva_id;

  update public.notas_ajuste_proveedor set anulada = true where id = p_nota_id;

  return v_nueva_id;
end;
$$;

-- ============================================================================
-- Bloque 42 · orden manual del catálogo de productos
--
-- El catálogo se mostraba siempre en orden de creación (más nuevo primero).
-- Se agrega una columna orden para que el negocio pueda reorganizar los
-- materiales manualmente, y ese orden se refleja en todos los selectores que
-- usan listarProductos() (pesaje, facturas, transformaciones, listas de
-- precios). Se backfillea preservando el orden visual que ya tenían (más
-- nuevo = orden 0) para no reordenar nada de golpe al desplegar esto.
-- ============================================================================

alter table public.productos add column if not exists orden integer not null default 0;

update public.productos p
set orden = sub.rn
from (
  select id, row_number() over (order by creado_en desc) - 1 as rn
  from public.productos
) sub
where p.id = sub.id;

create index if not exists idx_productos_orden on public.productos (orden);

-- ============================================================================
-- Bloque 43 · pesaje exterior (sin peso global obligatorio)
--
-- Algunos camiones se pesan en una báscula externa a la que Pronoia no tiene
-- acceso — para esos casos, el peso global deja de ser obligatorio y el
-- ticket queda marcado como "pesaje exterior" para dejarlo trazado.
--
-- crear_ticket_pesaje ya tenía DOS sobrecargas viviendo en la BD (9 y 10
-- parámetros — la de 9 quedó huérfana de un cambio anterior que agregó
-- p_devolucion sin dropear la firma vieja). Se dropean ambas antes de crear
-- la versión de 11 parámetros para no sumar una tercera sobrecarga ambigua.
-- ============================================================================

alter table public.tickets_pesaje
  add column if not exists pesaje_exterior boolean not null default false;

drop function if exists public.crear_ticket_pesaje(
  text, uuid, date, text[], text, jsonb, text, uuid, numeric
);
drop function if exists public.crear_ticket_pesaje(
  text, uuid, date, text[], text, jsonb, text, uuid, numeric, numeric
);

create function public.crear_ticket_pesaje(
  p_tipo            text,
  p_entidad_id      uuid,
  p_fecha           date,
  p_fotos           text[],
  p_observaciones   text,
  p_materiales      jsonb,
  p_estado          text,
  p_pesado_por      uuid,
  p_peso_global     numeric,
  p_devolucion      numeric default 0,
  p_pesaje_exterior boolean default false
) returns uuid
language plpgsql
as $$
declare
  v_id         uuid;
  v_item       jsonb;
  v_almacen_id uuid;
  v_numero     integer;
begin
  select id into v_almacen_id
    from public.almacenes
   where es_predeterminado and activo
   limit 1;

  if p_tipo = 'compra' then
    v_numero := nextval('public.tickets_pesaje_numero_compra_seq');
  else
    v_numero := nextval('public.tickets_pesaje_numero_venta_seq');
  end if;

  insert into public.tickets_pesaje
    (tipo, entidad_id, fecha, fotos, observaciones, estado, pesado_por,
     peso_global, devolucion, almacen_id, numero, pesaje_exterior)
  values (
    p_tipo, p_entidad_id, p_fecha, p_fotos, nullif(p_observaciones, ''),
    coalesce(p_estado, 'completo'), p_pesado_por, p_peso_global,
    coalesce(p_devolucion, 0), v_almacen_id, v_numero,
    coalesce(p_pesaje_exterior, false)
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

-- ============================================================================
-- Bloque 44 · fecha editable en notas + nota de crédito como pago + sin
-- bloqueo de saldo insuficiente
--
-- 1) notas_ajuste_proveedor gana una fecha de negocio editable (antes solo
--    existía created_at, el instante de inserción — mismo patrón que
--    tickets_pesaje.fecha vs created_at). Se backfillea con la fecha real de
--    creación de cada nota antes de fijar el default y el not null.
-- 2) registrar_pago_proveedor_multi_banca acepta 'nota_credito' como tercer
--    tipo de ítem del pago combinado: reduce lo que hace falta cubrir con
--    banca (al revés de nota_debito, que suma). Se marca pagada=true igual
--    que las notas de débito, ligada al movimiento principal del pago.
-- 3) Se quita el chequeo "Saldo insuficiente en <banca>" — Julio confirmó
--    que la cuenta puede quedar en negativo, no debe bloquear el pago.
-- ============================================================================

alter table public.notas_ajuste_proveedor add column if not exists fecha date;
update public.notas_ajuste_proveedor set fecha = created_at::date where fecha is null;
alter table public.notas_ajuste_proveedor alter column fecha set default current_date;
alter table public.notas_ajuste_proveedor alter column fecha set not null;

create or replace function public.registrar_pago_proveedor_multi_banca(
  p_proveedor_id   uuid,
  p_bancas         jsonb,     -- [{ "bancaId": uuid, "monto": numeric, "montoUsd": numeric, "moneda": "USD"|"VES", "referencia": text|null }]
  p_monto_usd      numeric,   -- total declarado por el usuario ("Total a pagar")
  p_descripcion    text,
  p_referencia     text,
  p_fecha          date,
  p_registrado_por uuid,
  p_items          jsonb      -- [{ "tipo": "factura"|"nota_debito"|"nota_credito", "id": uuid, "montoUsd": numeric }]
) returns jsonb
language plpgsql
as $$
declare
  v_item              jsonb;
  v_banca             jsonb;
  v_tipo               text;
  v_id                 uuid;
  v_monto              numeric;
  v_total              numeric;
  v_pagado             numeric;
  v_filas              int;
  v_total_cargos        numeric;
  v_total_creditos      numeric;
  v_total_items        numeric;
  v_total_bancas       numeric;
  v_adelanto           numeric;
  v_saldo              numeric;
  v_nombre             text;
  v_archivada          boolean;
  v_num_pago           bigint;
  v_num_adel           bigint;
  v_grupo_id           uuid;
  v_restante_pago      numeric;
  v_banca_id           uuid;
  v_banca_monto        numeric;
  v_banca_monto_usd    numeric;
  v_banca_moneda       text;
  v_banca_referencia   text;
  v_ap_pago_usd        numeric;
  v_ap_adel_usd        numeric;
  v_monto_pago         numeric;
  v_monto_adel         numeric;
  v_mov_id             uuid;
  v_mov_pago_principal uuid;
  v_mov_adel_principal uuid;
  v_ids                uuid[] := '{}';
begin
  if p_bancas is null or jsonb_typeof(p_bancas) <> 'array' or jsonb_array_length(p_bancas) = 0 then
    raise exception 'Debe indicar al menos una banca de origen.';
  end if;

  if (select count(*) from jsonb_array_elements(p_bancas)) <>
     (select count(distinct (value->>'bancaId')) from jsonb_array_elements(p_bancas)) then
    raise exception 'No se puede repetir la misma banca en un pago.';
  end if;

  select coalesce(sum(case when value->>'tipo' = 'nota_credito' then 0 else (value->>'montoUsd')::numeric end), 0) into v_total_cargos
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as elems(value);

  select coalesce(sum(case when value->>'tipo' = 'nota_credito' then (value->>'montoUsd')::numeric else 0 end), 0) into v_total_creditos
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as elems(value);

  if v_total_creditos > v_total_cargos + 0.01 then
    raise exception 'Las notas de crédito seleccionadas (%) superan lo que se está pagando (%).', v_total_creditos, v_total_cargos;
  end if;

  v_total_items := v_total_cargos - v_total_creditos;

  select coalesce(sum((value->>'montoUsd')::numeric), 0) into v_total_bancas
    from jsonb_array_elements(p_bancas) as elems(value);

  if abs(v_total_bancas - p_monto_usd) > 0.01 then
    raise exception 'La suma de las bancas (%) no coincide con el total a pagar (%).', v_total_bancas, p_monto_usd;
  end if;

  v_adelanto := round(p_monto_usd - v_total_items, 2);
  if v_adelanto < -0.01 then
    raise exception 'El total a pagar (%) es menor a la suma de lo seleccionado (%).', p_monto_usd, v_total_items;
  end if;
  if abs(v_adelanto) <= 0.01 then
    v_adelanto := 0;
  end if;

  -- Bloquea todas las bancas involucradas en orden estable (por id) antes de
  -- tocar ninguna, para no generar deadlocks con otro pago concurrente que
  -- use el mismo conjunto de bancas en distinto orden. Ya NO valida saldo
  -- suficiente — la cuenta puede quedar en negativo (decisión del negocio).
  for v_banca in
    select value from jsonb_array_elements(p_bancas) as elems(value)
    order by (value->>'bancaId')
  loop
    select saldo, nombre, archivada into v_saldo, v_nombre, v_archivada
      from public.bancas where id = (v_banca->>'bancaId')::uuid
      for update;

    if v_saldo is null then
      raise exception 'Banca % no encontrada.', v_banca->>'bancaId';
    end if;
    if v_archivada then
      raise exception 'La banca % está archivada.', v_nombre;
    end if;
  end loop;

  v_grupo_id := gen_random_uuid();
  if v_total_items > 0 then
    v_num_pago := nextval('public.movimientos_pago_numero_seq');
  end if;
  if v_adelanto > 0 then
    v_num_adel := nextval('public.movimientos_adelanto_numero_seq');
  end if;

  -- Reparte cada banca entre pago/adelanto en el orden en que el usuario las
  -- cargó (no el orden de bloqueo de arriba, que es solo para evitar
  -- deadlocks): llena primero el pago hasta agotar v_total_items, el resto
  -- de cada banca es adelanto.
  v_restante_pago := v_total_items;

  for v_banca in select value from jsonb_array_elements(p_bancas) as elems(value)
  loop
    v_banca_id := (v_banca->>'bancaId')::uuid;
    v_banca_monto := (v_banca->>'monto')::numeric;
    v_banca_monto_usd := (v_banca->>'montoUsd')::numeric;
    v_banca_moneda := v_banca->>'moneda';
    -- Referencia propia de esta banca; si viene vacía, cae a la referencia
    -- global del pago (compatibilidad con llamadas que no manden por línea).
    v_banca_referencia := coalesce(nullif(v_banca->>'referencia', ''), nullif(p_referencia, ''));

    if v_banca_monto_usd <= 0 then
      continue;
    end if;

    v_ap_pago_usd := least(v_banca_monto_usd, v_restante_pago);
    v_ap_adel_usd := v_banca_monto_usd - v_ap_pago_usd;
    v_restante_pago := v_restante_pago - v_ap_pago_usd;
    v_monto_pago := 0;

    if v_ap_pago_usd > 0.01 then
      v_monto_pago := round(v_banca_monto * v_ap_pago_usd / v_banca_monto_usd, 2);

      insert into public.movimientos
        (tipo, subtipo, numero, grupo_id, monto, moneda, monto_usd, descripcion,
         banca_origen_id, banca_destino_id, fecha, referencia, registrado_por, proveedor_id)
      values
        ('egreso', 'pago', v_num_pago, v_grupo_id, v_monto_pago, v_banca_moneda, v_ap_pago_usd,
         nullif(p_descripcion, ''), v_banca_id, null, p_fecha, v_banca_referencia,
         p_registrado_por, p_proveedor_id)
      returning id into v_mov_id;

      v_ids := v_ids || v_mov_id;
      if v_mov_pago_principal is null then v_mov_pago_principal := v_mov_id; end if;
    end if;

    if v_ap_adel_usd > 0.01 then
      -- Residuo exacto del monto en moneda local (no se recalcula por
      -- separado) para que la suma pago+adelanto de esta banca sea
      -- exactamente v_banca_monto, sin drift de centavos.
      v_monto_adel := v_banca_monto - v_monto_pago;

      insert into public.movimientos
        (tipo, subtipo, numero, grupo_id, monto, moneda, monto_usd, descripcion,
         banca_origen_id, banca_destino_id, fecha, referencia, registrado_por, proveedor_id)
      values
        ('egreso', 'adelanto', v_num_adel, v_grupo_id, v_monto_adel, v_banca_moneda, v_ap_adel_usd,
         nullif(case when v_total_items > 0 then 'Adelanto' else p_descripcion end, ''),
         v_banca_id, null, p_fecha, v_banca_referencia, p_registrado_por, p_proveedor_id)
      returning id into v_mov_id;

      v_ids := v_ids || v_mov_id;
      if v_mov_adel_principal is null then v_mov_adel_principal := v_mov_id; end if;
    end if;
  end loop;

  -- Aplica los ítems: factura acumula monto_pagado, nota_debito se marca
  -- pagada (suma al pago), nota_credito también se marca pagada (resta del
  -- pago, ya se descontó de v_total_items arriba) — ambas ligadas a la fila
  -- principal del pago (no a la del adelanto).
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as elems(value)
  loop
    v_tipo  := v_item->>'tipo';
    v_id    := (v_item->>'id')::uuid;
    v_monto := (v_item->>'montoUsd')::numeric;

    if v_tipo = 'factura' then
      select total, monto_pagado into v_total, v_pagado
        from public.facturas_compra where id = v_id and proveedor_id = p_proveedor_id;

      if v_total is null then
        raise exception 'Factura % no encontrada para este proveedor.', v_id;
      end if;

      v_pagado := coalesce(v_pagado, 0) + v_monto;

      update public.facturas_compra
         set monto_pagado = v_pagado,
             estado = case when v_pagado >= v_total - 0.01 then 'pagada' else estado end
       where id = v_id;

    elsif v_tipo = 'nota_debito' then
      update public.notas_ajuste_proveedor
         set pagada = true,
             movimiento_id = v_mov_pago_principal
       where id = v_id
         and proveedor_id = p_proveedor_id
         and tipo = 'debito'
         and anulada = false
         and pagada = false;

      get diagnostics v_filas = row_count;
      if v_filas = 0 then
        raise exception 'Nota de débito % no encontrada, ya pagada o anulada.', v_id;
      end if;

    elsif v_tipo = 'nota_credito' then
      update public.notas_ajuste_proveedor
         set pagada = true,
             movimiento_id = v_mov_pago_principal
       where id = v_id
         and proveedor_id = p_proveedor_id
         and tipo = 'credito'
         and anulada = false
         and pagada = false;

      get diagnostics v_filas = row_count;
      if v_filas = 0 then
        raise exception 'Nota de crédito % no encontrada, ya aplicada o anulada.', v_id;
      end if;

    else
      raise exception 'Tipo de ítem desconocido: %', v_tipo;
    end if;
  end loop;

  return jsonb_build_object(
    'movimientoPrincipalId', coalesce(v_mov_pago_principal, v_mov_adel_principal),
    'movimientoIds', to_jsonb(v_ids),
    'grupoId', v_grupo_id,
    'numeroPago', v_num_pago,
    'numeroAdelanto', v_num_adel
  );
end;
$$;


-- ============================================================================
-- Bloque 45 · Ventas: espejo de Compras (estado de cuenta escribible)
--
-- Compras ya tenía estado de cuenta + notas de crédito/débito + "Registrar
-- pago" con RPC multi-banca. Ventas solo tenía el lado de lectura (facturas +
-- estado de cuenta de solo consulta). Este bloque agrega el lado de
-- escritura para clientes, en espejo pero NO mezclado con lo de proveedor:
--
-- 1) facturas_venta gana monto_pagado (no existía — a diferencia de
--    facturas_compra, nunca se rastreaban pagos parciales de una venta).
-- 2) notas_ajuste_cliente: tabla nueva, mismas columnas que
--    notas_ajuste_proveedor, pero con numeración PROPIA (secuencias
--    separadas) — decisión explícita de Julio para no mezclar el correlativo
--    de notas a clientes con el de notas a proveedores.
-- 3) anular_nota_ajuste_cliente: espejo de anular_nota_ajuste_proveedor.
-- 4) movimientos.subtipo gana 'cobro'/'anticipo' (antes solo 'pago'/
--    'adelanto') — mismo mecanismo, numeración propia también.
-- 5) registrar_cobro_cliente_multi_banca: espejo de
--    registrar_pago_proveedor_multi_banca, pero tipo='ingreso' (entra plata,
--    no sale) — por eso NO tiene bloqueo de saldo (un ingreso nunca deja a
--    una banca en negativo, ni falta que lo tuviera antes: el bloqueo de
--    saldo insuficiente de Compras nunca aplicó acá).
-- ============================================================================

alter table public.facturas_venta add column if not exists monto_pagado numeric not null default 0;

create table if not exists public.notas_ajuste_cliente (
  id              uuid        primary key default gen_random_uuid(),
  cliente_id      uuid        not null references public.clientes(id),
  tipo            text        not null check (tipo in ('credito', 'debito')),
  monto           numeric     not null check (monto > 0),
  motivo          text        not null,
  anulada         boolean     not null default false,
  anula_nota_id   uuid        references public.notas_ajuste_cliente(id),
  registrado_por  uuid        references public.users(id),
  created_at      timestamptz not null default now(),
  pagada          boolean     not null default false,
  movimiento_id   uuid        references public.movimientos(id),
  numero          bigint,
  factura_id      uuid        references public.facturas_venta(id),
  fecha           date        not null default current_date
);

alter table public.notas_ajuste_cliente disable row level security;

create index if not exists idx_notas_ajuste_cliente_cliente
  on public.notas_ajuste_cliente (cliente_id);
create index if not exists idx_notas_ajuste_cliente_factura
  on public.notas_ajuste_cliente (factura_id);

-- Numeración propia para notas de cliente — nunca comparte contador con
-- notas_credito_numero_seq / notas_debito_numero_seq (esas son de proveedor).
create sequence if not exists public.notas_credito_cliente_numero_seq;
create sequence if not exists public.notas_debito_cliente_numero_seq;

create unique index if not exists idx_notas_ajuste_cliente_tipo_numero
  on public.notas_ajuste_cliente (tipo, numero);

create or replace function public.asignar_correlativo_nota_ajuste_cliente()
returns trigger
language plpgsql
as $$
begin
  if new.numero is null then
    if new.tipo = 'credito' then
      new.numero := nextval('public.notas_credito_cliente_numero_seq');
    elsif new.tipo = 'debito' then
      new.numero := nextval('public.notas_debito_cliente_numero_seq');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_asignar_correlativo_nota_ajuste_cliente on public.notas_ajuste_cliente;

create trigger trg_asignar_correlativo_nota_ajuste_cliente
before insert on public.notas_ajuste_cliente
for each row
execute function public.asignar_correlativo_nota_ajuste_cliente();

-- Espejo exacto de anular_nota_ajuste_proveedor: no borra, inserta la nota
-- contraria y marca la original como anulada.
create or replace function public.anular_nota_ajuste_cliente(
  p_nota_id uuid,
  p_motivo text,
  p_registrado_por uuid
) returns uuid
language plpgsql
as $$
declare
  v_cliente_id   uuid;
  v_tipo         text;
  v_monto        numeric;
  v_anulada      boolean;
  v_pagada       boolean;
  v_factura_id   uuid;
  v_nueva_id     uuid;
begin
  select cliente_id, tipo, monto, anulada, pagada, factura_id
    into v_cliente_id, v_tipo, v_monto, v_anulada, v_pagada, v_factura_id
    from public.notas_ajuste_cliente
   where id = p_nota_id;

  if v_cliente_id is null then
    raise exception 'Nota no encontrada.';
  end if;
  if v_anulada then
    raise exception 'Esta nota ya fue anulada.';
  end if;
  if v_pagada then
    raise exception 'Esta nota ya fue aplicada a un cobro — no se puede anular sin reversar antes el cobro.';
  end if;

  insert into public.notas_ajuste_cliente
    (cliente_id, tipo, monto, motivo, anula_nota_id, registrado_por, factura_id)
  values (
    v_cliente_id,
    case when v_tipo = 'credito' then 'debito' else 'credito' end,
    v_monto,
    p_motivo,
    p_nota_id,
    p_registrado_por,
    v_factura_id
  )
  returning id into v_nueva_id;

  update public.notas_ajuste_cliente set anulada = true where id = p_nota_id;

  return v_nueva_id;
end;
$$;

-- 'cobro'/'anticipo' son el espejo de 'pago'/'adelanto' para movimientos de
-- tipo 'ingreso' (cliente) en vez de 'egreso' (proveedor).
alter table public.movimientos drop constraint if exists movimientos_subtipo_check;
alter table public.movimientos add constraint movimientos_subtipo_check
  check (subtipo is null or subtipo = any (array['pago', 'adelanto', 'cobro', 'anticipo']));

create sequence if not exists public.movimientos_cobro_numero_seq;
create sequence if not exists public.movimientos_anticipo_cliente_numero_seq;

-- Espejo de registrar_pago_proveedor_multi_banca: mismo reparto entre varias
-- bancas, misma separación cobro/anticipo, mismo criterio nota_credito resta
-- / nota_debito suma. Diferencias: tipo='ingreso' (banca_origen_id recibe,
-- ver aplicar_movimiento_a_saldo del Bloque 2 — en un ingreso la plata entra
-- por banca_origen_id, no banca_destino_id), sin bloqueo de saldo (un
-- ingreso nunca dejaría una banca en negativo), numeración y tabla de notas
-- propias de cliente.
create or replace function public.registrar_cobro_cliente_multi_banca(
  p_cliente_id     uuid,
  p_bancas         jsonb,     -- [{ "bancaId": uuid, "monto": numeric, "montoUsd": numeric, "moneda": "USD"|"VES", "referencia": text|null }]
  p_monto_usd      numeric,   -- total declarado por el usuario ("Total a cobrar")
  p_descripcion    text,
  p_referencia     text,
  p_fecha          date,
  p_registrado_por uuid,
  p_items          jsonb      -- [{ "tipo": "factura"|"nota_debito"|"nota_credito", "id": uuid, "montoUsd": numeric }]
) returns jsonb
language plpgsql
as $$
declare
  v_item              jsonb;
  v_banca             jsonb;
  v_tipo               text;
  v_id                 uuid;
  v_monto              numeric;
  v_total              numeric;
  v_pagado             numeric;
  v_filas              int;
  v_total_cargos        numeric;
  v_total_creditos      numeric;
  v_total_items        numeric;
  v_total_bancas       numeric;
  v_adelanto           numeric;
  v_nombre             text;
  v_archivada          boolean;
  v_num_cobro          bigint;
  v_num_anticipo       bigint;
  v_grupo_id           uuid;
  v_restante_pago      numeric;
  v_banca_id           uuid;
  v_banca_monto        numeric;
  v_banca_monto_usd    numeric;
  v_banca_moneda       text;
  v_banca_referencia   text;
  v_ap_pago_usd        numeric;
  v_ap_adel_usd        numeric;
  v_monto_pago         numeric;
  v_monto_adel         numeric;
  v_mov_id             uuid;
  v_mov_cobro_principal    uuid;
  v_mov_anticipo_principal uuid;
  v_ids                uuid[] := '{}';
begin
  if p_bancas is null or jsonb_typeof(p_bancas) <> 'array' or jsonb_array_length(p_bancas) = 0 then
    raise exception 'Debe indicar al menos una banca de destino.';
  end if;

  if (select count(*) from jsonb_array_elements(p_bancas)) <>
     (select count(distinct (value->>'bancaId')) from jsonb_array_elements(p_bancas)) then
    raise exception 'No se puede repetir la misma banca en un cobro.';
  end if;

  select coalesce(sum(case when value->>'tipo' = 'nota_credito' then 0 else (value->>'montoUsd')::numeric end), 0) into v_total_cargos
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as elems(value);

  select coalesce(sum(case when value->>'tipo' = 'nota_credito' then (value->>'montoUsd')::numeric else 0 end), 0) into v_total_creditos
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as elems(value);

  if v_total_creditos > v_total_cargos + 0.01 then
    raise exception 'Las notas de crédito seleccionadas (%) superan lo que se está cobrando (%).', v_total_creditos, v_total_cargos;
  end if;

  v_total_items := v_total_cargos - v_total_creditos;

  select coalesce(sum((value->>'montoUsd')::numeric), 0) into v_total_bancas
    from jsonb_array_elements(p_bancas) as elems(value);

  if abs(v_total_bancas - p_monto_usd) > 0.01 then
    raise exception 'La suma de las bancas (%) no coincide con el total a cobrar (%).', v_total_bancas, p_monto_usd;
  end if;

  v_adelanto := round(p_monto_usd - v_total_items, 2);
  if v_adelanto < -0.01 then
    raise exception 'El total a cobrar (%) es menor a la suma de lo seleccionado (%).', p_monto_usd, v_total_items;
  end if;
  if abs(v_adelanto) <= 0.01 then
    v_adelanto := 0;
  end if;

  -- Bloquea todas las bancas involucradas en orden estable (por id) antes de
  -- tocar ninguna, mismo criterio anti-deadlock que el pago a proveedor. No
  -- valida saldo — un ingreso nunca puede dejar una banca en negativo.
  for v_banca in
    select value from jsonb_array_elements(p_bancas) as elems(value)
    order by (value->>'bancaId')
  loop
    select nombre, archivada into v_nombre, v_archivada
      from public.bancas where id = (v_banca->>'bancaId')::uuid
      for update;

    if v_nombre is null then
      raise exception 'Banca % no encontrada.', v_banca->>'bancaId';
    end if;
    if v_archivada then
      raise exception 'La banca % está archivada.', v_nombre;
    end if;
  end loop;

  v_grupo_id := gen_random_uuid();
  if v_total_items > 0 then
    v_num_cobro := nextval('public.movimientos_cobro_numero_seq');
  end if;
  if v_adelanto > 0 then
    v_num_anticipo := nextval('public.movimientos_anticipo_cliente_numero_seq');
  end if;

  v_restante_pago := v_total_items;

  for v_banca in select value from jsonb_array_elements(p_bancas) as elems(value)
  loop
    v_banca_id := (v_banca->>'bancaId')::uuid;
    v_banca_monto := (v_banca->>'monto')::numeric;
    v_banca_monto_usd := (v_banca->>'montoUsd')::numeric;
    v_banca_moneda := v_banca->>'moneda';
    v_banca_referencia := coalesce(nullif(v_banca->>'referencia', ''), nullif(p_referencia, ''));

    if v_banca_monto_usd <= 0 then
      continue;
    end if;

    v_ap_pago_usd := least(v_banca_monto_usd, v_restante_pago);
    v_ap_adel_usd := v_banca_monto_usd - v_ap_pago_usd;
    v_restante_pago := v_restante_pago - v_ap_pago_usd;
    v_monto_pago := 0;

    if v_ap_pago_usd > 0.01 then
      v_monto_pago := round(v_banca_monto * v_ap_pago_usd / v_banca_monto_usd, 2);

      -- tipo='ingreso': banca_origen_id es la que RECIBE la plata (ver
      -- aplicar_movimiento_a_saldo, Bloque 2) — no banca_destino_id.
      insert into public.movimientos
        (tipo, subtipo, numero, grupo_id, monto, moneda, monto_usd, descripcion,
         banca_origen_id, banca_destino_id, fecha, referencia, registrado_por, cliente_id)
      values
        ('ingreso', 'cobro', v_num_cobro, v_grupo_id, v_monto_pago, v_banca_moneda, v_ap_pago_usd,
         nullif(p_descripcion, ''), v_banca_id, null, p_fecha, v_banca_referencia,
         p_registrado_por, p_cliente_id)
      returning id into v_mov_id;

      v_ids := v_ids || v_mov_id;
      if v_mov_cobro_principal is null then v_mov_cobro_principal := v_mov_id; end if;
    end if;

    if v_ap_adel_usd > 0.01 then
      v_monto_adel := v_banca_monto - v_monto_pago;

      insert into public.movimientos
        (tipo, subtipo, numero, grupo_id, monto, moneda, monto_usd, descripcion,
         banca_origen_id, banca_destino_id, fecha, referencia, registrado_por, cliente_id)
      values
        ('ingreso', 'anticipo', v_num_anticipo, v_grupo_id, v_monto_adel, v_banca_moneda, v_ap_adel_usd,
         nullif(case when v_total_items > 0 then 'Anticipo' else p_descripcion end, ''),
         v_banca_id, null, p_fecha, v_banca_referencia, p_registrado_por, p_cliente_id)
      returning id into v_mov_id;

      v_ids := v_ids || v_mov_id;
      if v_mov_anticipo_principal is null then v_mov_anticipo_principal := v_mov_id; end if;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as elems(value)
  loop
    v_tipo  := v_item->>'tipo';
    v_id    := (v_item->>'id')::uuid;
    v_monto := (v_item->>'montoUsd')::numeric;

    if v_tipo = 'factura' then
      select total, monto_pagado into v_total, v_pagado
        from public.facturas_venta where id = v_id and cliente_id = p_cliente_id;

      if v_total is null then
        raise exception 'Factura % no encontrada para este cliente.', v_id;
      end if;

      v_pagado := coalesce(v_pagado, 0) + v_monto;

      update public.facturas_venta
         set monto_pagado = v_pagado,
             estado = case when v_pagado >= v_total - 0.01 then 'pagada' else estado end
       where id = v_id;

    elsif v_tipo = 'nota_debito' then
      update public.notas_ajuste_cliente
         set pagada = true,
             movimiento_id = v_mov_cobro_principal
       where id = v_id
         and cliente_id = p_cliente_id
         and tipo = 'debito'
         and anulada = false
         and pagada = false;

      get diagnostics v_filas = row_count;
      if v_filas = 0 then
        raise exception 'Nota de débito % no encontrada, ya aplicada o anulada.', v_id;
      end if;

    elsif v_tipo = 'nota_credito' then
      update public.notas_ajuste_cliente
         set pagada = true,
             movimiento_id = v_mov_cobro_principal
       where id = v_id
         and cliente_id = p_cliente_id
         and tipo = 'credito'
         and anulada = false
         and pagada = false;

      get diagnostics v_filas = row_count;
      if v_filas = 0 then
        raise exception 'Nota de crédito % no encontrada, ya aplicada o anulada.', v_id;
      end if;

    else
      raise exception 'Tipo de ítem desconocido: %', v_tipo;
    end if;
  end loop;

  return jsonb_build_object(
    'movimientoPrincipalId', coalesce(v_mov_cobro_principal, v_mov_anticipo_principal),
    'movimientoIds', to_jsonb(v_ids),
    'grupoId', v_grupo_id,
    'numeroCobro', v_num_cobro,
    'numeroAnticipo', v_num_anticipo
  );
end;
$$;
