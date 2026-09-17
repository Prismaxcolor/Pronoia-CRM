-- Extraído de producción vía pg_get_functiondef, 11-sep-2026
-- Args: p_toma_fisica_id uuid

CREATE OR REPLACE FUNCTION public.resumen_toma_fisica(p_toma_fisica_id uuid)
 RETURNS TABLE(producto_id uuid, producto_nombre text, lote_id uuid, lote_nombre text, stock_teorico numeric, stock_real numeric, diferencia numeric, cantidad_pesajes integer)
 LANGUAGE plpgsql
AS $function$
declare
  v_almacen_id uuid;
  v_categorias uuid[];
begin
  select almacen_id, categorias into v_almacen_id, v_categorias
    from public.tomas_fisicas_inventario where id = p_toma_fisica_id;

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
  ),
  con_lote_universo as (
    select null::uuid as producto_id, null::text as producto_nombre, cl.lote_id, l.nombre as lote_nombre,
           public.stock_lote_total(cl.lote_id) as teorico
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
$function$
;
