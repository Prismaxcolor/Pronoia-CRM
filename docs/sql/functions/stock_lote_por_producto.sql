-- Extraído de producción vía pg_get_functiondef, 11-sep-2026 (post fixes de esta sesión)
-- Args: p_lote_id uuid

CREATE OR REPLACE FUNCTION public.stock_lote_por_producto(p_lote_id uuid)
 RETURNS TABLE(producto_id uuid, stock numeric)
 LANGUAGE sql
 STABLE
AS $function$
  with transformacion_totales as (
    select transformacion_id, sum(peso_kg) as total_entrada
    from public.transformacion_entrada_detalle
    group by transformacion_id
  ),
  salida_distribuida as (
    -- reparte cada salida hacia un lote_destino proporcionalmente a la
    -- composición de entrada de esa misma transformación
    select tsd.lote_destino_id as lote_id,
           ted.producto_id,
           tsd.peso_neto * ted.peso_kg / tt.total_entrada as monto
    from public.transformacion_salida_detalle tsd
    join transformacion_totales tt on tt.transformacion_id = tsd.transformacion_id
    join public.transformacion_entrada_detalle ted on ted.transformacion_id = tsd.transformacion_id
    where tsd.lote_destino_id is not null
      and tt.total_entrada > 0
  )
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
    union all
    select ai.producto_id,
           case when ai.diferencia > 0 then ai.diferencia else 0 end,
           case when ai.diferencia < 0 then -ai.diferencia else 0 end
    from public.ajustes_inventario ai
    where ai.lote_id = p_lote_id
      and ai.producto_id is not null
    union all
    -- NUEVO: composición heredada del origen para lotes que recibieron
    -- material vía transformación (PCB/legacy)
    select producto_id, monto, 0::numeric
    from salida_distribuida
    where lote_id = p_lote_id and producto_id is not null
  ) x
  where producto_id is not null
  group by producto_id;
$function$
;
