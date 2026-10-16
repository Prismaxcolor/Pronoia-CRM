-- Extraído de producción vía pg_get_functiondef, 11-sep-2026 (post fixes de esta sesión)
-- Args: p_almacen_id uuid

CREATE OR REPLACE FUNCTION public.stock_almacen(p_almacen_id uuid)
 RETURNS TABLE(producto_id uuid, stock numeric)
 LANGUAGE sql
 STABLE
AS $function$
  with sin_lote as (
    select producto_id, sum(entrada) - sum(salida) as stock from (
      select dt.producto_id, coalesce(dt.peso_recibido, 0) as entrada, 0::numeric as salida
      from public.detalle_traslado dt join public.tickets_traslado t on t.id = dt.traslado_id
      where t.almacen_destino_id = p_almacen_id and t.estado = 'completo'
      union all
      -- el origen descuenta desde que el traslado se CREA (pendiente o
      -- completo): el material ya salió físicamente.
      select dt.producto_id, 0::numeric, coalesce(dt.peso_neto, 0)
      from public.detalle_traslado dt join public.tickets_traslado t on t.id = dt.traslado_id
      where t.almacen_origen_id = p_almacen_id and t.estado in ('pendiente', 'completo')
      union all
      -- compras/ventas SIN lote: se atribuyen al almacén del ticket, igual
      -- que antes. Las de destino_tipo='lote' se excluyen aquí a propósito
      -- (se cuentan en con_lote, vía el almacén real del lote).
      select d.producto_id, coalesce(d.peso_neto, 0), 0::numeric
      from public.detalle_tickets_pesaje d join public.tickets_pesaje tp on tp.id = d.ticket_id
      where tp.almacen_id = p_almacen_id and tp.tipo = 'compra'
        and coalesce(nullif(d.destino_tipo, ''), 'mpp') <> 'lote'
      union all
      select d.producto_id, 0::numeric, coalesce(d.peso_neto, 0)
      from public.detalle_tickets_pesaje d join public.tickets_pesaje tp on tp.id = d.ticket_id
      where tp.almacen_id = p_almacen_id and tp.tipo = 'venta'
        and coalesce(nullif(d.destino_tipo, ''), 'mpp') <> 'lote'
      union all
      select producto_id, greatest(diferencia, 0), greatest(-diferencia, 0)
      from public.ajustes_inventario
      where almacen_id = p_almacen_id and lote_id is null
      union all
      select ted.producto_id, 0::numeric, coalesce(ted.peso_kg, 0)
      from public.transformacion_entrada_detalle ted
      join public.transformaciones t on t.id = ted.transformacion_id
      where t.almacen_id = p_almacen_id and t.categoria = 'ferroso_no_ferroso'
      union all
      select tsd.producto_id, coalesce(tsd.peso_neto, 0), 0::numeric
      from public.transformacion_salida_detalle tsd
      join public.transformaciones t on t.id = tsd.transformacion_id
      where t.almacen_id = p_almacen_id and t.categoria = 'ferroso_no_ferroso' and t.estado = 'completa'
    ) x where producto_id is not null group by producto_id
  ),
  con_lote as (
    -- todo el material de lotes PCB cuyo almacén ACTUAL es este, reusando
    -- el cálculo de stock_lote_por_producto() (fuente ya correcta) en vez
    -- de reimplementar la lógica de compras/ventas/transformaciones/ajustes
    -- por lote otra vez aquí.
    select slp.producto_id, sum(slp.stock) as stock
    from public.lotes l
    cross join lateral public.stock_lote_por_producto(l.id) slp
    where l.almacen_id = p_almacen_id
    group by slp.producto_id
  )
  select producto_id, sum(stock) as stock
  from (
    select * from sin_lote
    union all
    select * from con_lote
  ) z
  group by producto_id;
$function$
;
