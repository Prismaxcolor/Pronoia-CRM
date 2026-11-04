-- Extraído de producción vía pg_get_functiondef, 11-sep-2026 (post fixes de esta sesión)
-- Args: 

CREATE OR REPLACE FUNCTION public.stock_global()
 RETURNS TABLE(producto_id uuid, stock numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select producto_id, sum(stock) as stock
  from public.almacenes a
  cross join lateral public.stock_almacen(a.id) s
  where a.activo
  group by producto_id;
$function$
;
