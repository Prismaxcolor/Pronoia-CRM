-- Extraído de producción vía pg_get_functiondef, 11-sep-2026 (post fixes de esta sesión)
-- Args: p_lote_id uuid

CREATE OR REPLACE FUNCTION public.composicion_lote(p_lote_id uuid)
 RETURNS TABLE(producto_id uuid, producto_nombre text, stock numeric, porcentaje numeric)
 LANGUAGE sql
 STABLE
AS $function$
  with base as (
    select slp.producto_id, p.nombre as producto_nombre, slp.stock
    from public.stock_lote_por_producto(p_lote_id) slp
    join public.productos p on p.id = slp.producto_id
    where slp.stock > 0
      and public.stock_lote_total(p_lote_id) > 0.01
  ),
  total as (select coalesce(sum(stock), 0) as t from base)
  select b.producto_id, b.producto_nombre, b.stock,
    case when t.t > 0 then round(b.stock / t.t * 100, 2) else 0 end as porcentaje
  from base b cross join total t
  order by b.stock desc;
$function$
;
