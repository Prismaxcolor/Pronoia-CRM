-- =============================================================================
-- MIGRACIÓN: La composición de un lote DESTINO de transformación (PCB o legacy)
--            ahora se deriva realmente de la composición del lote ORIGEN,
--            distribuida proporcionalmente según cuánto recibió cada destino.
--
-- PROBLEMA: transformacion_salida_detalle tiene columna producto_id pero
-- completar_transformacion() y completar_transformacion_pcb() NUNCA la
-- llenan (insertan solo lote_destino_id + peso_bruto/tara, sin desglose).
-- Y stock_lote_por_producto() nunca leía transformacion_salida_detalle en
-- absoluto. Resultado: el lote destino recibía el kg total correcto (via
-- stock_lote_total, que sí sumaba transformacion_salida_detalle.peso_neto en
-- bruto) pero su "composición real" (stock_lote_por_producto / composicion_lote)
-- quedaba vacía o incompleta — no reflejaba qué materiales (MIXTO I, FILO
-- DORADO, CENTRALES, etc.) realmente entraron. El comentario en el código
-- ("la composición real se recalcula sola a partir del stock real") era
-- aspiracional, no real.
--
-- FIX: composición del destino = composición del origen al momento de crear
-- la transformación (ya capturada en transformacion_entrada_detalle),
-- repartida proporcionalmente entre los lotes destino según el peso_neto
-- que cada uno recibió. Esto es exactamente lo que ya simulaba
-- proyectarComposicion() en el frontend (TransformacionesPage.tsx) como
-- preview — ahora el backend lo hace real.
--
-- Nota: esto NO aplica a transformación ferroso — ahí el operador declara
-- explícitamente el producto_id de salida (material final reclasificado),
-- que ya se guarda correctamente. Solo PCB/legacy (salida a lote_destino_id)
-- necesitaban heredar composición.
--
-- CÓMO APLICAR: pegar en Supabase Studio → SQL Editor y ejecutar.
-- =============================================================================

create or replace function public.stock_lote_por_producto(p_lote_id uuid)
returns table(producto_id uuid, stock numeric)
language sql
stable
as $$
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
$$;

create or replace function public.stock_lote_total(p_lote_id uuid)
returns numeric
language sql
stable
as $$
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
  )
  select coalesce((select sum(stock) from public.stock_lote_por_producto(p_lote_id)), 0)
       + coalesce((select sum(monto) from salida_null_distribuida where lote_id = p_lote_id), 0)
       + coalesce((
           select sum(ai.diferencia)
           from public.ajustes_inventario ai
           where ai.lote_id = p_lote_id
             and ai.producto_id is null
         ), 0);
$$;

-- VERIFICACIÓN RÁPIDA (descomentar para comprobar antes de aplicar):
-- 1. El total no debe cambiar para lotes que NUNCA recibieron una transformación:
-- select l.nombre, public.stock_lote_total(l.id) as stock_total
-- from public.lotes l order by l.nombre;
--
-- 2. Para un lote destino de una transformación PCB completada, ahora debe
--    aparecer composición (antes salía vacío):
-- select * from public.composicion_lote('<uuid del lote destino>');
