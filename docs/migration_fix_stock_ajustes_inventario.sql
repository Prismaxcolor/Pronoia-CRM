-- =============================================================================
-- MIGRACIÓN: Incluir ajustes_inventario en stock_lote_por_producto y
--            stock_lote_total (fuente única de verdad para kg en lotes).
--
-- PROBLEMA: stock_lote_por_producto() y stock_lote_total() calculaban el stock
-- sin incluir los ajustes de toma física (tabla ajustes_inventario). Esto
-- causaba discrepancias entre la pantalla de inventario (que SÍ los incluía
-- via inventario-service.ts) y la toma física / transformaciones (que usaban
-- estas funciones SQL y veían un stock diferente).
--
-- EFECTO: después de aplicar, el stock que muestra el lote, el teórico de
-- la toma física, y el límite de retiro en transformaciones son todos iguales
-- y provienen de una única fuente de verdad.
--
-- CÓMO APLICAR: pegar en Supabase Studio → SQL Editor y ejecutar.
-- =============================================================================

-- 1. stock_lote_por_producto: ahora incluye ajustes por producto de tomas físicas.
create or replace function public.stock_lote_por_producto(p_lote_id uuid)
returns table(producto_id uuid, stock numeric)
language sql
stable
as $$
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
    -- ajustes de toma física por producto (diferencia positiva = excedente, negativa = faltante)
    select ai.producto_id,
           case when ai.diferencia > 0 then ai.diferencia else 0 end,
           case when ai.diferencia < 0 then -ai.diferencia else 0 end
    from public.ajustes_inventario ai
    where ai.lote_id = p_lote_id
      and ai.producto_id is not null
  ) x
  where producto_id is not null
  group by producto_id;
$$;

-- 2. stock_lote_total: ahora incluye ajustes sin producto (lotes PCB contados como un todo).
--    Los ajustes con producto ya quedan incluidos vía stock_lote_por_producto arriba.
create or replace function public.stock_lote_total(p_lote_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce((select sum(stock) from public.stock_lote_por_producto(p_lote_id)), 0)
       + coalesce((
           select sum(tsd.peso_neto)
           from public.transformacion_salida_detalle tsd
           where tsd.lote_destino_id = p_lote_id
         ), 0)
       + coalesce((
           -- ajustes de toma física sin producto (lotes PCB contados como un todo)
           select sum(ai.diferencia)
           from public.ajustes_inventario ai
           where ai.lote_id = p_lote_id
             and ai.producto_id is null
         ), 0);
$$;

-- VERIFICACIÓN RÁPIDA (descomentar para comprobar antes de aplicar):
-- Debería devolver el mismo kg que muestra la pantalla de Inventario para cada lote.
-- select l.nombre, public.stock_lote_total(l.id) as stock_total
-- from public.lotes l
-- order by l.nombre;
