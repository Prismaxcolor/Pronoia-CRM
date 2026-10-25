-- =============================================================================
-- FASE 3 del plan de consolidación — función nueva stock_global().
--
-- Hoy no existe ninguna función SQL que devuelva "cuánto hay de este
-- material en todo el negocio, sin importar almacén" — es exactamente el
-- número que Julio mira en /inventario y el que espera ver al vender
-- (decisión P-1/P-3 del plan: la disponibilidad que se muestra al vender es
-- la global, nunca bloquea, el almacén es solo trazabilidad).
--
-- Reutiliza stock_almacen() (ya corregida en la Fase 3) sumada sobre todos
-- los almacenes activos — no reimplementa el cálculo de cero.
-- =============================================================================

create or replace function public.stock_global()
returns table(producto_id uuid, stock numeric)
language sql
stable
as $$
  select producto_id, sum(stock) as stock
  from public.almacenes a
  cross join lateral public.stock_almacen(a.id) s
  where a.activo
  group by producto_id;
$$;
