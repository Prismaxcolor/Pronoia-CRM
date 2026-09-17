-- =============================================================================
-- MIGRACIÓN: stock_lote_total() ahora resta también la porción "sin producto"
--            que salió de un lote como origen de una transformación PCB/legacy.
--
-- PROBLEMA (encontrado auditando el caso real de "LOTE MPP", reportado por
-- Julio el 10-sep-2026: /inventario mostraba 500 kg, /transformaciones
-- mostraba 1.500 kg para el mismo lote):
--
-- crear_transformacion_pcb()/crear_transformacion() reparten el peso neto
-- que se retira de un lote origen entre sus productos conocidos y, si sobra
-- masa sin clasificar, insertan una fila en transformacion_entrada_detalle
-- con producto_id = NULL (ver v_null_kg). stock_lote_por_producto() excluye
-- a propósito las filas producto_id NULL de su resultado (where producto_id
-- is not null) porque no tiene sentido devolver un "producto" nulo — pero
-- stock_lote_total(), que se apoya en stock_lote_por_producto() para el
-- total, NUNCA restaba esa porción por separado. Resultado: cada vez que se
-- transforma un lote con masa sin clasificar, su stock_lote_total() se queda
-- inflado para siempre por exactamente esa cantidad — y como
-- crear_transformacion()/crear_transformacion_pcb() validan el límite de kg
-- disponibles contra stock_lote_total(), esto también permitía "transformar"
-- más material del que físicamente quedaba en el lote.
--
-- Caso real: LOTE MPP tuvo un ajuste neto de +1.500 kg (sin producto) y dos
-- transformaciones que retiraron 500 kg + 500 kg sin clasificar (producto_id
-- NULL) cada una. Físicamente deberían quedar 500 kg. stock_lote_total()
-- devolvía 1.500 kg porque nunca restaba esos 1.000 kg retirados.
--
-- Nótese que el caso simétrico (el lote DESTINO de esa misma masa sin
-- clasificar) SÍ estaba cubierto desde la migración del 09-sep
-- (migration_fix_composicion_lote_destino_transformacion.sql,
-- salida_null_distribuida) — este fix completa la otra mitad, que se quedó
-- afuera.
--
-- FIX: nueva CTE retiro_null_origen, resta del total la suma de
-- transformacion_entrada_detalle.peso_kg con producto_id NULL cuyo
-- lote_origen_id sea este lote.
--
-- CÓMO APLICAR: pegar en Supabase Studio → SQL Editor y ejecutar.
-- =============================================================================

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
$$;

-- VERIFICACIÓN RÁPIDA (descomentar para comprobar antes de aplicar):
-- select public.stock_lote_total('4933946c-0649-4c3a-b54b-4dfa4b7af8a3'); -- LOTE MPP, debe dar 500, no 1500
