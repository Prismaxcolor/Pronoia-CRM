-- =============================================================================
-- FASE 3 del plan de consolidación (docs/PLAN_consolidacion_inventario.md):
-- stock_almacen() deja de recalcular el stock de material con lote a mano
-- y reutiliza stock_lote_por_producto() (ya correcta) para eso, atribuyendo
-- cada lote a su almacén REAL (lotes.almacen_id) en vez del almacén del
-- ticket que lo compró.
--
-- Corrige de raíz:
--   RC-5: el material que sale de un lote por una transformación PCB
--         nunca se restaba del almacén (solo se restaba para ferroso/no-
--         ferroso). Ahora, como el total del lote se calcula con
--         stock_lote_por_producto() —que sí descuenta transformaciones
--         PCB—, esto queda resuelto automáticamente.
--   RC-6: el almacén de un lote y el almacén de sus kilos eran datos
--         distintos (lotes.almacen_id vs tickets_pesaje.almacen_id). Ahora
--         todo el material de un lote se atribuye al almacén que el lote
--         tiene HOY, que es el mismo que ves y editas en la pantalla de
--         Lotes.
--
-- El material SIN lote (compras/ventas 'mpp', traslados, ajustes sin lote,
-- transformaciones ferroso/no-ferroso) no cambia de cálculo.
--
-- CÓMO APLICAR: pegar en Supabase Studio → SQL Editor y ejecutar.
-- =============================================================================

create or replace function public.stock_almacen(p_almacen_id uuid)
returns table(producto_id uuid, stock numeric)
language sql
stable
as $$
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
$$;
