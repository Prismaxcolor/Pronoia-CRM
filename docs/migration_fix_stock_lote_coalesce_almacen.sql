-- =============================================================================
-- migration_fix_stock_lote_coalesce_almacen.sql
--
-- Alinea el stock por lote/almacén con el resto del sistema: una salida de
-- transformación hacia un lote (tipos B y C) pertenece al almacén de la salida
-- (transformacion_salida_detalle.almacen_id) o, si la salida no lo indica, al
-- de la transformación: coalesce(tsd.almacen_id, transformaciones.almacen_id).
-- Es la misma regla de stock_almacen (rama de material suelto) y de
-- backend/src/utils/movimientos-almacen.ts. Antes, las funciones por lote
-- ignoraban las salidas con tsd.almacen_id nulo.
--
-- Funciones tocadas (solo cambia el almacén de la salida; nada más):
--   * stock_lote_almacen_por_producto (salida_distribuida tipo B y rama tipo C)
--   * stock_lote_por_almacen          (rama de salidas hacia el lote)
-- composicion_lote_almacen y stock_lote_almacen_total se alimentan de estas
-- dos y no cambian.
--
-- Idempotente (create or replace). Probado en begin/rollback contra prod el
-- 2026-10-07: 0 diferencias de stock (hoy no hay salidas a lote con almacén
-- nulo; las 62 con almacen_id nulo son de material suelto).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.stock_lote_almacen_por_producto(p_lote_id uuid, p_almacen_id uuid)
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
    select tsd.lote_destino_id as lote_id, coalesce(tsd.almacen_id, tr.almacen_id) as almacen_id,
           ted.producto_id,
           tsd.peso_neto * ted.peso_kg / tt.total_entrada as monto
    from public.transformacion_salida_detalle tsd
    join public.transformaciones tr on tr.id = tsd.transformacion_id
    join transformacion_totales tt on tt.transformacion_id = tsd.transformacion_id
    join public.transformacion_entrada_detalle ted on ted.transformacion_id = tsd.transformacion_id
    where tsd.lote_destino_id is not null and tsd.producto_id is null and tt.total_entrada > 0
  )
  select producto_id, sum(entrada) - sum(salida) as stock
  from (
    -- compras directas al lote, en ESTE almacén
    select d.producto_id, coalesce(d.peso_neto, 0) as entrada, 0::numeric as salida
    from public.detalle_tickets_pesaje d
    join public.tickets_pesaje tp on tp.id = d.ticket_id
    where d.destino_tipo = 'lote' and d.lote_id = p_lote_id and tp.tipo = 'compra' and tp.almacen_id = p_almacen_id
    union all
    -- ventas directas del lote, en ESTE almacén
    select d.producto_id, 0::numeric, coalesce(d.peso_neto, 0)
    from public.detalle_tickets_pesaje d
    join public.tickets_pesaje tp on tp.id = d.ticket_id
    where d.destino_tipo = 'lote' and d.lote_id = p_lote_id and tp.tipo = 'venta' and tp.almacen_id = p_almacen_id
    union all
    -- transformación PCB que consumió este lote DESDE este almacén
    select ted.producto_id, 0::numeric, coalesce(ted.peso_kg, 0)
    from public.transformacion_entrada_detalle ted
    join public.transformaciones t on t.id = ted.transformacion_id
    where t.lote_origen_id = p_lote_id and t.almacen_id = p_almacen_id
    union all
    -- ajustes de toma física / manuales, en ESTE almacén, con producto
    select ai.producto_id,
           case when ai.diferencia > 0 then ai.diferencia else 0 end,
           case when ai.diferencia < 0 then -ai.diferencia else 0 end
    from public.ajustes_inventario ai
    where ai.lote_id = p_lote_id and ai.almacen_id = p_almacen_id and ai.producto_id is not null
    union all
    -- recibido de una transformación cuya salida quedó asignada a ESTE almacén
    select producto_id, monto, 0::numeric
    from salida_distribuida
    where lote_id = p_lote_id and almacen_id = p_almacen_id and producto_id is not null
    union all
    -- salida con producto explícito hacia este lote en ESTE almacén (tipo C)
    select tsd.producto_id, coalesce(tsd.peso_neto, 0), 0::numeric
    from public.transformacion_salida_detalle tsd
    join public.transformaciones tr on tr.id = tsd.transformacion_id
    where tsd.lote_destino_id = p_lote_id and coalesce(tsd.almacen_id, tr.almacen_id) = p_almacen_id
      and tsd.producto_id is not null and tr.estado = 'completa'
    union all
    -- traslado RECIBIDO: composición que llegó, escalada a lo efectivamente
    -- recibido (puede diferir de lo despachado por discrepancia de pesaje).
    select dtc.producto_id, dtc.peso_kg * (dt.peso_recibido / nullif(dt.peso_neto, 0)), 0::numeric
    from public.detalle_traslado_composicion dtc
    join public.detalle_traslado dt on dt.id = dtc.detalle_traslado_id
    join public.tickets_traslado t on t.id = dt.traslado_id
    where dt.lote_id = p_lote_id and t.almacen_destino_id = p_almacen_id and t.estado = 'completo'
      and dtc.producto_id is not null
    union all
    -- traslado ENVIADO: composición que salió (snapshot al pesar) — se
    -- descuenta desde que el traslado se CREA, igual que el peso total.
    select dtc.producto_id, 0::numeric, dtc.peso_kg
    from public.detalle_traslado_composicion dtc
    join public.detalle_traslado dt on dt.id = dtc.detalle_traslado_id
    join public.tickets_traslado t on t.id = dt.traslado_id
    where dt.lote_id = p_lote_id and t.almacen_origen_id = p_almacen_id and t.estado in ('pendiente', 'completo')
      and dtc.producto_id is not null
  ) x
  where producto_id is not null
  group by producto_id;
$function$;

CREATE OR REPLACE FUNCTION public.stock_lote_por_almacen(p_lote_id uuid)
 RETURNS TABLE(almacen_id uuid, stock numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select almacen_id, sum(entrada) - sum(salida) as stock
  from (
    select tp.almacen_id, coalesce(d.peso_neto, 0) as entrada, 0::numeric as salida
    from public.detalle_tickets_pesaje d
    join public.tickets_pesaje tp on tp.id = d.ticket_id
    where d.destino_tipo = 'lote' and d.lote_id = p_lote_id and tp.tipo = 'compra'
      and tp.almacen_id is not null
    union all
    select tp.almacen_id, 0::numeric, coalesce(d.peso_neto, 0)
    from public.detalle_tickets_pesaje d
    join public.tickets_pesaje tp on tp.id = d.ticket_id
    where d.destino_tipo = 'lote' and d.lote_id = p_lote_id and tp.tipo = 'venta'
      and tp.almacen_id is not null
    union all
    select t.almacen_origen_id, 0::numeric, coalesce(dt.peso_neto, 0)
    from public.detalle_traslado dt
    join public.tickets_traslado t on t.id = dt.traslado_id
    where dt.lote_id = p_lote_id and t.estado in ('pendiente', 'completo')
    union all
    select t.almacen_destino_id, coalesce(dt.peso_recibido, 0), 0::numeric
    from public.detalle_traslado dt
    join public.tickets_traslado t on t.id = dt.traslado_id
    where dt.lote_id = p_lote_id and t.estado = 'completo'
    union all
    select tr.almacen_id, 0::numeric, coalesce(tr.peso_neto, 0)
    from public.transformaciones tr
    where tr.lote_origen_id = p_lote_id and tr.categoria = 'pcb'
    union all
    select coalesce(tsd.almacen_id, tr.almacen_id), coalesce(tsd.peso_neto, 0), 0::numeric
    from public.transformacion_salida_detalle tsd
    join public.transformaciones tr on tr.id = tsd.transformacion_id
    where tsd.lote_destino_id = p_lote_id and tr.estado = 'completa'
    union all
    select ai.almacen_id, greatest(ai.diferencia, 0), greatest(-ai.diferencia, 0)
    from public.ajustes_inventario ai
    where ai.lote_id = p_lote_id and ai.almacen_id is not null
  ) x
  where almacen_id is not null
  group by almacen_id;
$function$;

-- =============================================================================
-- ROLLBACK (definiciones vigentes antes de esta migración)
-- =============================================================================
-- CREATE OR REPLACE FUNCTION public.stock_lote_almacen_por_producto(p_lote_id uuid, p_almacen_id uuid)
--  RETURNS TABLE(producto_id uuid, stock numeric)
--  LANGUAGE sql
--  STABLE
-- AS $function$
--   with transformacion_totales as (
--     select transformacion_id, sum(peso_kg) as total_entrada
--     from public.transformacion_entrada_detalle
--     group by transformacion_id
--   ),
--   salida_distribuida as (
--     select tsd.lote_destino_id as lote_id, tsd.almacen_id,
--            ted.producto_id,
--            tsd.peso_neto * ted.peso_kg / tt.total_entrada as monto
--     from public.transformacion_salida_detalle tsd
--     join transformacion_totales tt on tt.transformacion_id = tsd.transformacion_id
--     join public.transformacion_entrada_detalle ted on ted.transformacion_id = tsd.transformacion_id
--     where tsd.lote_destino_id is not null and tsd.producto_id is null and tt.total_entrada > 0
--   )
--   select producto_id, sum(entrada) - sum(salida) as stock
--   from (
--     -- compras directas al lote, en ESTE almacén
--     select d.producto_id, coalesce(d.peso_neto, 0) as entrada, 0::numeric as salida
--     from public.detalle_tickets_pesaje d
--     join public.tickets_pesaje tp on tp.id = d.ticket_id
--     where d.destino_tipo = 'lote' and d.lote_id = p_lote_id and tp.tipo = 'compra' and tp.almacen_id = p_almacen_id
--     union all
--     -- ventas directas del lote, en ESTE almacén
--     select d.producto_id, 0::numeric, coalesce(d.peso_neto, 0)
--     from public.detalle_tickets_pesaje d
--     join public.tickets_pesaje tp on tp.id = d.ticket_id
--     where d.destino_tipo = 'lote' and d.lote_id = p_lote_id and tp.tipo = 'venta' and tp.almacen_id = p_almacen_id
--     union all
--     -- transformación PCB que consumió este lote DESDE este almacén
--     select ted.producto_id, 0::numeric, coalesce(ted.peso_kg, 0)
--     from public.transformacion_entrada_detalle ted
--     join public.transformaciones t on t.id = ted.transformacion_id
--     where t.lote_origen_id = p_lote_id and t.almacen_id = p_almacen_id
--     union all
--     -- ajustes de toma física / manuales, en ESTE almacén, con producto
--     select ai.producto_id,
--            case when ai.diferencia > 0 then ai.diferencia else 0 end,
--            case when ai.diferencia < 0 then -ai.diferencia else 0 end
--     from public.ajustes_inventario ai
--     where ai.lote_id = p_lote_id and ai.almacen_id = p_almacen_id and ai.producto_id is not null
--     union all
--     -- recibido de una transformación cuya salida quedó asignada a ESTE almacén
--     select producto_id, monto, 0::numeric
--     from salida_distribuida
--     where lote_id = p_lote_id and almacen_id = p_almacen_id and producto_id is not null
--     union all
--     -- salida con producto explícito hacia este lote en ESTE almacén (tipo C)
--     select tsd.producto_id, coalesce(tsd.peso_neto, 0), 0::numeric
--     from public.transformacion_salida_detalle tsd
--     join public.transformaciones tr on tr.id = tsd.transformacion_id
--     where tsd.lote_destino_id = p_lote_id and tsd.almacen_id = p_almacen_id
--       and tsd.producto_id is not null and tr.estado = 'completa'
--     union all
--     -- traslado RECIBIDO: composición que llegó, escalada a lo efectivamente
--     -- recibido (puede diferir de lo despachado por discrepancia de pesaje).
--     select dtc.producto_id, dtc.peso_kg * (dt.peso_recibido / nullif(dt.peso_neto, 0)), 0::numeric
--     from public.detalle_traslado_composicion dtc
--     join public.detalle_traslado dt on dt.id = dtc.detalle_traslado_id
--     join public.tickets_traslado t on t.id = dt.traslado_id
--     where dt.lote_id = p_lote_id and t.almacen_destino_id = p_almacen_id and t.estado = 'completo'
--       and dtc.producto_id is not null
--     union all
--     -- traslado ENVIADO: composición que salió (snapshot al pesar) — se
--     -- descuenta desde que el traslado se CREA, igual que el peso total.
--     select dtc.producto_id, 0::numeric, dtc.peso_kg
--     from public.detalle_traslado_composicion dtc
--     join public.detalle_traslado dt on dt.id = dtc.detalle_traslado_id
--     join public.tickets_traslado t on t.id = dt.traslado_id
--     where dt.lote_id = p_lote_id and t.almacen_origen_id = p_almacen_id and t.estado in ('pendiente', 'completo')
--       and dtc.producto_id is not null
--   ) x
--   where producto_id is not null
--   group by producto_id;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.stock_lote_por_almacen(p_lote_id uuid)
--  RETURNS TABLE(almacen_id uuid, stock numeric)
--  LANGUAGE sql
--  STABLE
-- AS $function$
--   select almacen_id, sum(entrada) - sum(salida) as stock
--   from (
--     select tp.almacen_id, coalesce(d.peso_neto, 0) as entrada, 0::numeric as salida
--     from public.detalle_tickets_pesaje d
--     join public.tickets_pesaje tp on tp.id = d.ticket_id
--     where d.destino_tipo = 'lote' and d.lote_id = p_lote_id and tp.tipo = 'compra'
--       and tp.almacen_id is not null
--     union all
--     select tp.almacen_id, 0::numeric, coalesce(d.peso_neto, 0)
--     from public.detalle_tickets_pesaje d
--     join public.tickets_pesaje tp on tp.id = d.ticket_id
--     where d.destino_tipo = 'lote' and d.lote_id = p_lote_id and tp.tipo = 'venta'
--       and tp.almacen_id is not null
--     union all
--     select t.almacen_origen_id, 0::numeric, coalesce(dt.peso_neto, 0)
--     from public.detalle_traslado dt
--     join public.tickets_traslado t on t.id = dt.traslado_id
--     where dt.lote_id = p_lote_id and t.estado in ('pendiente', 'completo')
--     union all
--     select t.almacen_destino_id, coalesce(dt.peso_recibido, 0), 0::numeric
--     from public.detalle_traslado dt
--     join public.tickets_traslado t on t.id = dt.traslado_id
--     where dt.lote_id = p_lote_id and t.estado = 'completo'
--     union all
--     select tr.almacen_id, 0::numeric, coalesce(tr.peso_neto, 0)
--     from public.transformaciones tr
--     where tr.lote_origen_id = p_lote_id and tr.categoria = 'pcb'
--     union all
--     select tsd.almacen_id, coalesce(tsd.peso_neto, 0), 0::numeric
--     from public.transformacion_salida_detalle tsd
--     join public.transformaciones tr on tr.id = tsd.transformacion_id
--     where tsd.lote_destino_id = p_lote_id and tr.estado = 'completa'
--     union all
--     select ai.almacen_id, greatest(ai.diferencia, 0), greatest(-ai.diferencia, 0)
--     from public.ajustes_inventario ai
--     where ai.lote_id = p_lote_id and ai.almacen_id is not null
--   ) x
--   where almacen_id is not null
--   group by almacen_id;
-- $function$;
