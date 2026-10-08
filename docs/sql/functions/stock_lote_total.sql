-- Extraído de producción vía pg_get_functiondef, 11-sep-2026 (post fixes de esta sesión)
-- Args: p_lote_id uuid

CREATE OR REPLACE FUNCTION public.stock_lote_total(p_lote_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  with transformacion_totales as (
    select transformacion_id, sum(peso_kg) as total_entrada
    from public.transformacion_entrada_detalle
    group by transformacion_id
  ),
  -- porción de cada salida que corresponde a material "sin desglose" (producto_id NULL)
  -- del lote origen — se suma aparte porque stock_lote_por_producto solo devuelve producto_id NOT NULL
  salida_null_distribuida as (
    select tsd.lote_destino_id as lote_id,
           tsd.peso_neto * ted_null.peso_kg / tt.total_entrada as monto
    from public.transformacion_salida_detalle tsd
    join transformacion_totales tt on tt.transformacion_id = tsd.transformacion_id
    join public.transformacion_entrada_detalle ted_null
      on ted_null.transformacion_id = tsd.transformacion_id and ted_null.producto_id is null
    where tsd.lote_destino_id is not null
      and tt.total_entrada > 0
  ),
  -- simétrico del anterior: la porción "sin desglose" que salió de ESTE lote
  -- como origen de una transformación nunca aparece en
  -- stock_lote_por_producto() (que solo devuelve producto_id NOT NULL), así
  -- que hay que restarla aparte.
  retiro_null_origen as (
    select coalesce(sum(ted.peso_kg), 0) as monto
    from public.transformacion_entrada_detalle ted
    join public.transformaciones t on t.id = ted.transformacion_id
    where t.lote_origen_id = p_lote_id
      and ted.producto_id is null
  )
  select coalesce((select sum(stock) from public.stock_lote_por_producto(p_lote_id)), 0)
       + coalesce((select sum(monto) from salida_null_distribuida where lote_id = p_lote_id), 0)
       - coalesce((select monto from retiro_null_origen), 0)
       + coalesce((
           select sum(ai.diferencia)
           from public.ajustes_inventario ai
           where ai.lote_id = p_lote_id
             and ai.producto_id is null
         ), 0);
$function$
;
