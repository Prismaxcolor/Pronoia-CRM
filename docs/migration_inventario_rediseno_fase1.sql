-- =============================================================================
-- Rediseño de /inventario - FASE 1: modelo de datos
-- =============================================================================
-- MIGRACIÓN ADITIVA E IDEMPOTENTE, en una sola transacción. No modifica ni borra
-- datos, ni toca los cálculos de stock existentes (stock_almacen, stock_lote_*,
-- completar_transformacion_*, editar_transformacion_pesos...). Rollback completo
-- en docs/migration_inventario_rediseno_fase1_ROLLBACK.sql.
--
-- Qué crea:
--   1. configuracion_inventario     parámetros NO secretos (meta del contenedor, umbrales).
--                                   Separada de configuracion_secreta. Se siembran 4 valores.
--   2. lotes.clase                  'exportacion' | 'trabajo' | 'otro' (default 'otro').
--      lotes.precio_estimado_kg     USD/kg aproximado de VENTA (nullable, >= 0).
--      lotes.precio_estimado_actualizado_en / _por
--      Clasifica SOLO los lotes cuya decisión es explícita (ver paso 2) y SOLO en la corrida
--      que crea la columna: re-ejecutar la migración no pisa clases elegidas a mano.
--   3. transformacion_merma_detalle merma tipificada (basura/plástico/tierra/hierro/otro)
--      registrar_merma_transformacion(uuid, jsonb)   reemplazo atómico del desglose.
--   4. lote_embalajes               kilos de un lote marcados como embalados/listos.
--      marcar_lote_embalado(...)    valida contra el stock con lock del lote.
--      anular_lote_embalaje(...)    anula sin borrar.
--   5. productos.vendible           bandera informativa (default true). Se pone en false
--                                   solo para 'CATALIZADORES COMPLETOS' (el catalizador
--                                   entero nunca se vende: siempre pasa a polvo = Lote 4).
--                                   NADA en la BD la consume todavía: no bloquea ventas.
--
-- Seguridad: RLS activado SIN políticas y REVOKE a anon/authenticated en las tablas
-- nuevas (solo service_role, el backend). Las funciones nuevas tienen EXECUTE
-- revocado a public/anon/authenticated y concedido a service_role.
--
-- Cómo ensayar sin riesgo: ejecutar primero en una copia/branch, o pegar el
-- archivo completo en el SQL Editor (ya trae begin/commit; ante cualquier error
-- no queda nada aplicado).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. configuracion_inventario
-- ---------------------------------------------------------------------------
create table if not exists public.configuracion_inventario (
  clave            text primary key,
  valor            numeric not null,
  tipo             text not null check (tipo in ('entero', 'decimal')),
  minimo           numeric not null,
  maximo           numeric not null,
  descripcion      text,
  actualizado_en   timestamptz not null default now(),
  actualizado_por  uuid references public.users(id) on delete set null,
  constraint configuracion_inventario_rango check (valor >= minimo and valor <= maximo),
  constraint configuracion_inventario_entero check (tipo <> 'entero' or valor = trunc(valor))
);

alter table public.configuracion_inventario enable row level security;
revoke all on table public.configuracion_inventario from public, anon, authenticated;
grant select, insert, update, delete on table public.configuracion_inventario to service_role;

insert into public.configuracion_inventario (clave, valor, tipo, minimo, maximo, descripcion) values
  ('meta_contenedor_kg',   18000, 'decimal', 1000, 100000, 'Meta de kilos por contenedor de exportación.'),
  ('umbral_merma_pct',         8, 'decimal',  0.1,    100, 'Porcentaje de merma a partir del cual se marca una transformación como alta.'),
  ('alerta_dias_amarilla',    60, 'entero',     1,   3650, 'Días sin movimiento para la alerta amarilla.'),
  ('alerta_dias_roja',        90, 'entero',     1,   3650, 'Días sin movimiento para la alerta roja.')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------------
-- 2. lotes: clase y precio estimado de venta
-- ---------------------------------------------------------------------------
-- La columna 'clase' y la clasificación inicial van en UN solo bloque: la clasificación
-- solo se aplica en la corrida que CREA la columna. En re-ejecuciones no se toca nada,
-- así no se pisan las clases que alguien haya elegido a mano (p. ej. un lote que se
-- dejó en 'otro' a propósito).
do $$
declare
  v_columna_nueva boolean;
begin
  v_columna_nueva := not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'lotes' and column_name = 'clase'
  );

  alter table public.lotes add column if not exists clase text not null default 'otro';

  if v_columna_nueva then
    -- Clasificación SOLO donde la decisión de Julio es explícita (2026-10-03):
    --   exportacion: LOTE 1, LOTE 2, LOTE 3, LOTE 4
    --   trabajo:     BGPP, BGYP, PCPP, PCYP (aún no existe), LOTE MPP
    -- El resto queda 'otro'.
    update public.lotes set clase = 'exportacion' where nombre in ('LOTE 1', 'LOTE 2', 'LOTE 3', 'LOTE 4');
    update public.lotes set clase = 'trabajo' where nombre in ('BGPP', 'BGYP', 'PCPP', 'PCYP', 'LOTE MPP');
  end if;
end $$;

alter table public.lotes add column if not exists precio_estimado_kg numeric;
alter table public.lotes add column if not exists precio_estimado_actualizado_en timestamptz;
alter table public.lotes add column if not exists precio_estimado_actualizado_por uuid
  references public.users(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lotes_clase_check' and conrelid = 'public.lotes'::regclass) then
    alter table public.lotes
      add constraint lotes_clase_check check (clase in ('exportacion', 'trabajo', 'otro'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lotes_precio_estimado_check' and conrelid = 'public.lotes'::regclass) then
    -- < 1e6 descarta NaN e Infinity (en numeric NaN es mayor que todo).
    alter table public.lotes
      add constraint lotes_precio_estimado_check
      check (precio_estimado_kg is null or (precio_estimado_kg >= 0 and precio_estimado_kg < 1000000));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Merma tipificada
-- ---------------------------------------------------------------------------
create table if not exists public.transformacion_merma_detalle (
  id                uuid primary key default gen_random_uuid(),
  transformacion_id uuid not null references public.transformaciones(id) on delete cascade,
  tipo              text not null check (tipo in ('basura', 'plastico', 'tierra', 'hierro', 'otro')),
  peso_kg           numeric not null check (peso_kg > 0 and peso_kg < 1000000),
  created_at        timestamptz not null default now()
);
-- Un renglón por tipo y transformación (la función consolida los repetidos).
create unique index if not exists transformacion_merma_detalle_trans_tipo_uq
  on public.transformacion_merma_detalle (transformacion_id, tipo);

alter table public.transformacion_merma_detalle enable row level security;
revoke all on table public.transformacion_merma_detalle from public, anon, authenticated;
grant select, insert, update, delete on table public.transformacion_merma_detalle to service_role;

-- Reemplaza (atómicamente) el desglose de merma de una transformación COMPLETA.
-- p_detalle: [{"tipo":"basura","peso_kg":1.5}, ...]; [] borra el desglose.
-- Regla: suma tipificada <= merma derivada (neto entrada - suma neto salidas) + 0.01 kg.
-- Devuelve jsonb { mermaKg, tipificadaKg, sinClasificarKg, antes:{tipo:kg}, despues:{tipo:kg} }
-- (antes/despues sirven para la auditoría). No toca pesos, salidas ni stock.
create or replace function public.registrar_merma_transformacion(
  p_transformacion_id uuid,
  p_detalle           jsonb
) returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_estado     text;
  v_neto       numeric;
  v_salidas    numeric;
  v_merma      numeric;
  v_item       jsonb;
  v_tipo       text;
  v_peso       numeric;
  v_agrupado   jsonb := '{}'::jsonb;
  v_total      numeric := 0;
  v_antes      jsonb;
  v_tipo_k     text;
begin
  select t.estado, coalesce(t.peso_neto, 0)
    into v_estado, v_neto
    from public.transformaciones t
   where t.id = p_transformacion_id
     for update;

  if v_estado is null then
    raise exception 'Transformación no encontrada.';
  end if;
  if v_estado <> 'completa' then
    raise exception 'La merma se registra al completar la transformación.';
  end if;
  if p_detalle is null or jsonb_typeof(p_detalle) <> 'array' then
    raise exception 'El detalle de merma debe ser una lista.';
  end if;

  for v_item in select value from jsonb_array_elements(p_detalle) as elems(value)
  loop
    v_tipo := v_item->>'tipo';
    if v_tipo is null or v_tipo not in ('basura', 'plastico', 'tierra', 'hierro', 'otro') then
      raise exception 'Tipo de merma inválido: %.', coalesce(v_tipo, 'vacío');
    end if;
    begin
      v_peso := nullif(v_item->>'peso_kg', '')::numeric;
    exception when invalid_text_representation then
      raise exception 'El peso de la merma "%" no es un número válido.', v_tipo;
    end;
    if v_peso is null or not (v_peso > 0 and v_peso < 1000000) then
      raise exception 'El peso de la merma "%" debe ser mayor a 0.', v_tipo;
    end if;
    v_agrupado := jsonb_set(
      v_agrupado, array[v_tipo],
      to_jsonb(coalesce((v_agrupado->>v_tipo)::numeric, 0) + v_peso)
    );
    v_total := v_total + v_peso;
  end loop;

  select coalesce(sum(s.peso_neto), 0) into v_salidas
    from public.transformacion_salida_detalle s
   where s.transformacion_id = p_transformacion_id;
  v_merma := v_neto - v_salidas;

  if v_total > greatest(v_merma, 0) + 0.01 then
    raise exception 'La merma por tipo suma % kg y supera la merma de la transformación (% kg).',
      round(v_total, 3), round(greatest(v_merma, 0), 3);
  end if;

  select coalesce(jsonb_object_agg(d.tipo, d.peso_kg), '{}'::jsonb) into v_antes
    from public.transformacion_merma_detalle d
   where d.transformacion_id = p_transformacion_id;

  delete from public.transformacion_merma_detalle where transformacion_id = p_transformacion_id;
  for v_tipo_k in select jsonb_object_keys(v_agrupado)
  loop
    insert into public.transformacion_merma_detalle (transformacion_id, tipo, peso_kg)
    values (p_transformacion_id, v_tipo_k, (v_agrupado->>v_tipo_k)::numeric);
  end loop;

  return jsonb_build_object(
    'mermaKg', round(v_merma, 3),
    'tipificadaKg', round(v_total, 3),
    'sinClasificarKg', round(greatest(v_merma - v_total, 0), 3),
    'antes', v_antes,
    'despues', v_agrupado
  );
end;
$function$;

revoke execute on function public.registrar_merma_transformacion(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_merma_transformacion(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Embalado por kilos
-- ---------------------------------------------------------------------------
create table if not exists public.lote_embalajes (
  id             uuid primary key default gen_random_uuid(),
  lote_id        uuid not null references public.lotes(id),
  almacen_id     uuid references public.almacenes(id),
  peso_kg        numeric not null check (peso_kg > 0 and peso_kg < 10000000),
  nota           text check (nota is null or char_length(nota) <= 500),
  contenedor     text check (contenedor is null or char_length(contenedor) <= 80),
  marcado_por    uuid references public.users(id) on delete set null,
  marcado_en     timestamptz not null default now(),
  anulado        boolean not null default false,
  anulado_por    uuid references public.users(id) on delete set null,
  anulado_en     timestamptz,
  anulado_motivo text check (anulado_motivo is null or char_length(anulado_motivo) <= 300),
  constraint lote_embalajes_anulacion_completa
    check (not anulado or (anulado_en is not null and anulado_motivo is not null))
);
create index if not exists lote_embalajes_lote_vigentes_idx
  on public.lote_embalajes (lote_id) where not anulado;
create index if not exists lote_embalajes_almacen_idx
  on public.lote_embalajes (almacen_id) where almacen_id is not null;

alter table public.lote_embalajes enable row level security;
revoke all on table public.lote_embalajes from public, anon, authenticated;
grant select, insert, update, delete on table public.lote_embalajes to service_role;

-- Marca p_peso_kg de un lote como embalados/listos. Atómico: bloquea la fila del
-- lote, así dos embalajes simultáneos no pueden pasarse del stock. Valida contra
-- el stock total del lote y, si se indica almacén, también contra el de ese almacén.
create or replace function public.marcar_lote_embalado(
  p_lote_id     uuid,
  p_almacen_id  uuid,
  p_peso_kg     numeric,
  p_nota        text,
  p_contenedor  text,
  p_marcado_por uuid
) returns uuid
language plpgsql
set search_path = public
as $function$
declare
  v_existe     uuid;
  v_stock      numeric;
  v_embalado   numeric;
  v_id         uuid;
begin
  if p_peso_kg is null or not (p_peso_kg > 0 and p_peso_kg < 10000000) then
    raise exception 'Los kilos a embalar deben ser mayores a 0.';
  end if;

  select l.id into v_existe from public.lotes l where l.id = p_lote_id for update;
  if v_existe is null then
    raise exception 'Lote no encontrado.';
  end if;
  if p_almacen_id is not null
     and not exists (select 1 from public.almacenes a where a.id = p_almacen_id) then
    raise exception 'Almacén no encontrado.';
  end if;

  v_stock := coalesce(public.stock_lote_total(p_lote_id), 0);
  select coalesce(sum(e.peso_kg), 0) into v_embalado
    from public.lote_embalajes e where e.lote_id = p_lote_id and not e.anulado;
  if p_peso_kg > greatest(v_stock - v_embalado, 0) + 0.001 then
    raise exception 'Solo quedan % kg sin embalar en este lote (stock %, ya embalado %).',
      round(greatest(v_stock - v_embalado, 0), 3), round(v_stock, 3), round(v_embalado, 3);
  end if;

  if p_almacen_id is not null then
    v_stock := coalesce(public.stock_lote_almacen_total(p_lote_id, p_almacen_id), 0);
    select coalesce(sum(e.peso_kg), 0) into v_embalado
      from public.lote_embalajes e
     where e.lote_id = p_lote_id and e.almacen_id = p_almacen_id and not e.anulado;
    if p_peso_kg > greatest(v_stock - v_embalado, 0) + 0.001 then
      raise exception 'Solo quedan % kg sin embalar de este lote en ese almacén (stock %, ya embalado %).',
        round(greatest(v_stock - v_embalado, 0), 3), round(v_stock, 3), round(v_embalado, 3);
    end if;
  end if;

  insert into public.lote_embalajes (lote_id, almacen_id, peso_kg, nota, contenedor, marcado_por)
  values (
    p_lote_id, p_almacen_id, p_peso_kg,
    nullif(btrim(p_nota), ''), nullif(btrim(p_contenedor), ''), p_marcado_por
  )
  returning id into v_id;
  return v_id;
end;
$function$;

revoke execute on function public.marcar_lote_embalado(uuid, uuid, numeric, text, text, uuid) from public, anon, authenticated;
grant execute on function public.marcar_lote_embalado(uuid, uuid, numeric, text, text, uuid) to service_role;

-- Anula un embalaje (no lo borra). Exige motivo. Anular dos veces es un error.
create or replace function public.anular_lote_embalaje(
  p_embalaje_id uuid,
  p_motivo      text,
  p_anulado_por uuid
) returns void
language plpgsql
set search_path = public
as $function$
declare
  v_anulado boolean;
  v_motivo  text := nullif(btrim(p_motivo), '');
begin
  if v_motivo is null then
    raise exception 'Indica el motivo de la anulación.';
  end if;
  if char_length(v_motivo) > 300 then
    raise exception 'El motivo no puede pasar de 300 caracteres.';
  end if;

  select e.anulado into v_anulado from public.lote_embalajes e where e.id = p_embalaje_id for update;
  if v_anulado is null then
    raise exception 'Embalaje no encontrado.';
  end if;
  if v_anulado then
    raise exception 'Este embalaje ya estaba anulado.';
  end if;

  update public.lote_embalajes
     set anulado = true, anulado_por = p_anulado_por, anulado_en = now(), anulado_motivo = v_motivo
   where id = p_embalaje_id;
end;
$function$;

revoke execute on function public.anular_lote_embalaje(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.anular_lote_embalaje(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. productos.vendible (bandera informativa)
-- ---------------------------------------------------------------------------
alter table public.productos add column if not exists vendible boolean not null default true;

-- El catalizador entero nunca se vende: siempre pasa a polvo (Lote 4).
-- Solo el producto exacto y dentro de la categoría PGM.
update public.productos p
   set vendible = false
  from public.tipos_material t
 where t.id = p.tipo_material_id
   and t.nombre = 'PGM'
   and p.nombre = 'CATALIZADORES COMPLETOS'
   and p.vendible;

-- Resultado de la clasificación (informativo).
select nombre, clase, precio_estimado_kg from public.lotes order by clase, nombre;

commit;
