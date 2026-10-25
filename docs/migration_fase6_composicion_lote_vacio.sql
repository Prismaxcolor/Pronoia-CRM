-- =============================================================================
-- FASE 6 del plan de consolidación (docs/PLAN_consolidacion_inventario.md):
-- un lote con stock total <= 0 ya no muestra composición.
--
-- PROBLEMA (RC-10 / síntoma S-2 reportado por Julio): composicion_lote()
-- calculaba el % sobre la suma de los productos con stock > 0, sin mirar
-- el stock TOTAL real del lote (stock_lote_total(), que sí incluye líneas
-- negativas). Un lote sobrevendido podía tener un producto en +50 y otro
-- en -50 (stock_lote_total = 0) y seguir mostrando "100% del producto A"
-- como si el lote estuviera lleno.
--
-- FIX: si stock_lote_total(lote) <= 0.01, el lote no tiene composición
-- (retorna vacío). No se tocó el cálculo interno del %, solo se agregó la
-- condición de entrada.
-- =============================================================================

create or replace function public.composicion_lote(p_lote_id uuid)
returns table(producto_id uuid, producto_nombre text, stock numeric, porcentaje numeric)
language sql
stable
as $$
  with base as (
    select slp.producto_id, p.nombre as producto_nombre, slp.stock
    from public.stock_lote_por_producto(p_lote_id) slp
    join public.productos p on p.id = slp.producto_id
    where slp.stock > 0
      and public.stock_lote_total(p_lote_id) > 0.01
  ),
  total as (select coalesce(sum(stock), 0) as t from base)
  select b.producto_id, b.producto_nombre, b.stock,
    case when t.t > 0 then round(b.stock / t.t * 100, 2) else 0 end as porcentaje
  from base b cross join total t
  order by b.stock desc;
$$;
