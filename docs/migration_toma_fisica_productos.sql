-- =============================================================================
-- Toma física SELECTIVA: contar solo los materiales elegidos de una categoría.
--
-- Hoy una toma "Por categoría" cuenta TODOS los productos activos de las
-- categorías elegidas: el que no se pesa queda con real 0 y, al culminar, se
-- ajusta a 0. Esta migración agrega tomas_fisicas_inventario.producto_ids:
--   - NULL (todas las tomas existentes y las que cubren toda la categoría):
--     comportamiento de siempre.
--   - lista de productos: resumen_toma_fisica (y por lo tanto culminar, que
--     ajusta solo lo que lista el resumen) considera únicamente esos materiales,
--     y registrar_pesaje_toma_fisica rechaza pesajes de otros materiales.
--
-- Aditiva e idempotente, en una transacción. No toca stock ni datos existentes.
-- Backend (toma-fisica-service.ts) solo envía p_producto_ids cuando la selección
-- es parcial, así que funciona antes y después de aplicar esta migración
-- (antes de aplicarla, una selección parcial falla con el error del RPC).
--
-- Base: definiciones vigentes de resumen_toma_fisica
-- (migration_lote_composicion_por_almacen.sql, sección 7) y de
-- registrar_pesaje_toma_fisica / crear_toma_fisica_inventario (docs/sql/functions).
--
-- ROLLBACK (manual):
--   begin;
--     drop function if exists public.crear_toma_fisica_inventario(uuid, uuid[], text, uuid, uuid[], uuid[]);
--     -- recrear la de 5 argumentos desde docs/sql/functions/crear_toma_fisica_inventario.sql
--     -- y resumen_toma_fisica / registrar_pesaje_toma_fisica desde sus versiones anteriores
--     alter table public.tomas_fisicas_inventario drop column if exists producto_ids;
--   commit;
-- =============================================================================

begin;

alter table public.tomas_fisicas_inventario add column if not exists producto_ids uuid[];

-- Se reemplaza la firma de 5 argumentos (un overload dejaría ambigua la llamada del backend).
drop function if exists public.crear_toma_fisica_inventario(uuid, uuid[], text, uuid, uuid[]);

create or replace function public.crear_toma_fisica_inventario(
  p_almacen_id uuid, p_categorias uuid[], p_descripcion text, p_abierta_por uuid,
  p_lote_ids uuid[] default null::uuid[], p_producto_ids uuid[] default null::uuid[]
)
 returns uuid
 language plpgsql
as $function$
declare
  v_id uuid;
begin
  if p_categorias is null or array_length(p_categorias, 1) is null then
    raise exception 'Elige al menos una categoría a inventariar.';
  end if;

  if exists (
    select 1 from public.tomas_fisicas_inventario
    where almacen_id = p_almacen_id and estado = 'abierta' and categorias && p_categorias
  ) then
    raise exception 'Ya hay una toma física abierta para alguna de estas categorías en este almacén.';
  end if;

  insert into public.tomas_fisicas_inventario (almacen_id, categorias, descripcion, abierta_por, lote_ids, producto_ids)
  values (p_almacen_id, p_categorias, nullif(p_descripcion, ''), p_abierta_por, nullif(p_lote_ids, '{}'), nullif(p_producto_ids, '{}'))
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.resumen_toma_fisica(p_toma_fisica_id uuid)
returns table(producto_id uuid, producto_nombre text, lote_id uuid, lote_nombre text, stock_teorico numeric, stock_real numeric, diferencia numeric, cantidad_pesajes integer)
language plpgsql
as $function$
declare
  v_almacen_id uuid;
  v_categorias uuid[];
  v_producto_ids uuid[];
begin
  select tf.almacen_id, tf.categorias, tf.producto_ids into v_almacen_id, v_categorias, v_producto_ids
    from public.tomas_fisicas_inventario tf where tf.id = p_toma_fisica_id;

  if v_almacen_id is null then
    raise exception 'Toma física no encontrada.';
  end if;

  return query
  with contado_producto as (
    select d.producto_id, sum(d.peso_neto) as real_kg, count(*)::int as pesajes
    from public.detalle_toma_fisica d
    where d.toma_fisica_id = p_toma_fisica_id and d.producto_id is not null
    group by d.producto_id
  ),
  contado_lote as (
    select d.lote_id, sum(d.peso_neto) as real_kg, count(*)::int as pesajes
    from public.detalle_toma_fisica d
    where d.toma_fisica_id = p_toma_fisica_id and d.producto_id is null
    group by d.lote_id
  ),
  sin_lote_universo as (
    select p.id as producto_id, p.nombre as producto_nombre, null::uuid as lote_id, null::text as lote_nombre,
           coalesce(sg.stock, 0) as teorico
    from public.productos p
    join public.tipos_material tm on tm.id = p.tipo_material_id and tm.sin_lote = true
    left join public.stock_almacen(v_almacen_id) sg on sg.producto_id = p.id
    where p.activo = true and p.tipo_material_id = any(v_categorias)
      and (v_producto_ids is null or p.id = any(v_producto_ids))
  ),
  con_lote_universo as (
    select null::uuid as producto_id, null::text as producto_nombre, cl.lote_id, l.nombre as lote_nombre,
           public.stock_lote_almacen_total(cl.lote_id, v_almacen_id) as teorico
    from contado_lote cl
    join public.lotes l on l.id = cl.lote_id
  ),
  universo as (
    select * from sin_lote_universo
    union all
    select * from con_lote_universo
  )
  select
    u.producto_id, u.producto_nombre, u.lote_id, u.lote_nombre,
    u.teorico,
    coalesce(cp.real_kg, cl.real_kg, 0),
    coalesce(cp.real_kg, cl.real_kg, 0) - u.teorico,
    coalesce(cp.pesajes, cl.pesajes, 0)
  from universo u
  left join contado_producto cp on u.producto_id is not null and cp.producto_id = u.producto_id
  left join contado_lote cl on u.lote_id is not null and u.producto_id is null and cl.lote_id = u.lote_id
  order by u.producto_nombre nulls last, u.lote_nombre nulls last;
end;
$function$;

create or replace function public.registrar_pesaje_toma_fisica(p_toma_fisica_id uuid, p_producto_id uuid, p_lote_id uuid, p_peso_bruto numeric, p_tara numeric, p_fotos text[], p_registrado_por uuid)
 returns uuid
 language plpgsql
as $function$
declare
  v_estado       text;
  v_lote_ids     uuid[];
  v_producto_ids uuid[];
  v_id           uuid;
begin
  select tf.estado, tf.lote_ids, tf.producto_ids into v_estado, v_lote_ids, v_producto_ids
    from public.tomas_fisicas_inventario tf where tf.id = p_toma_fisica_id;
  if v_estado is null then
    raise exception 'Toma física no encontrada.';
  end if;
  if v_estado <> 'abierta' then
    raise exception 'Esta toma física ya está cerrada.';
  end if;
  if coalesce(p_peso_bruto, 0) - coalesce(p_tara, 0) < 0 then
    raise exception 'El peso neto no puede ser negativo.';
  end if;
  if p_fotos is null or array_length(p_fotos, 1) is null then
    raise exception 'Cada pesaje de conteo requiere al menos una foto.';
  end if;
  if p_producto_id is null and p_lote_id is null then
    raise exception 'Elige un material o un lote.';
  end if;
  if v_lote_ids is not null and array_length(v_lote_ids, 1) is not null
     and p_lote_id is not null and not (p_lote_id = any(v_lote_ids)) then
    raise exception 'Ese lote no forma parte de esta toma física.';
  end if;
  if v_producto_ids is not null and array_length(v_producto_ids, 1) is not null
     and p_producto_id is not null and not (p_producto_id = any(v_producto_ids)) then
    raise exception 'Ese material no forma parte de esta toma física.';
  end if;

  insert into public.detalle_toma_fisica (toma_fisica_id, producto_id, lote_id, peso_bruto, tara, fotos, registrado_por)
  values (p_toma_fisica_id, p_producto_id, p_lote_id, p_peso_bruto, coalesce(p_tara, 0), p_fotos, p_registrado_por)
  returning id into v_id;

  return v_id;
end;
$function$;

commit;
