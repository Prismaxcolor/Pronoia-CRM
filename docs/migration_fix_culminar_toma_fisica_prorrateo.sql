-- =============================================================================
-- MIGRACIÓN: culminar_toma_fisica_inventario() prorratea el ajuste de un lote
--            contado como bloque sobre el TOTAL real (stock_lote_total),
--            no solo sobre la suma de productos con stock positivo.
--
-- PROBLEMA: cuando se cuenta un lote entero de una vez (sin desglose por
-- producto), la función tomaba v_total_comp = suma de stock_lote_por_producto
-- WHERE stock > 0, e ignoraba: (a) cualquier porción "sin desglose" del lote
-- (remanente producto_id NULL, típico de transformaciones PCB que dejan masa
-- no identificada) y (b) productos con stock negativo heredado. Si
-- v_total_comp no coincidía exactamente con stock_teorico (= stock_lote_total,
-- la fuente de verdad real), el prorrateo dejaba productos en negativo para
-- compensar la porción no tocada, aunque el TOTAL del lote sí cuadrara.
--
-- FIX: se calcula un único factor de escala = (stock_teorico + diferencia) /
-- stock_teorico, aplicado a TODOS los productos conocidos (incluyendo los que
-- ya estaban en negativo) y también al remanente "sin desglose" (calculado
-- como stock_teorico - suma de productos conocidos, sin filtrar por signo).
-- Así el reparto conserva exactamente la masa total y no fuerza negativos
-- artificiales en productos que no tenían nada que ver con el conteo.
--
-- CÓMO APLICAR: pegar en Supabase Studio → SQL Editor y ejecutar.
-- =============================================================================

create or replace function public.culminar_toma_fisica_inventario(p_toma_fisica_id uuid, p_cerrada_por uuid)
returns void
language plpgsql
as $function$
declare
  v_estado      text;
  v_almacen_id  uuid;
  v_fila        record;
  v_comp        record;
  v_total_comp  numeric;
  v_null_actual numeric;
  v_factor      numeric;
  v_snapshot    jsonb;
begin
  select estado, almacen_id into v_estado, v_almacen_id
    from public.tomas_fisicas_inventario where id = p_toma_fisica_id;

  if v_estado is null then
    raise exception 'Toma física no encontrada.';
  end if;
  if v_estado <> 'abierta' then
    raise exception 'Esta toma física ya está cerrada.';
  end if;

  select json_agg(row_to_json(r)) into v_snapshot
    from public.resumen_toma_fisica(p_toma_fisica_id) r;

  for v_fila in select * from public.resumen_toma_fisica(p_toma_fisica_id)
  loop
    continue when v_fila.diferencia = 0;

    if v_fila.producto_id is not null then
      insert into public.ajustes_inventario
        (toma_fisica_id, producto_id, lote_id, almacen_id, stock_teorico, stock_real, registrado_por)
      values
        (p_toma_fisica_id, v_fila.producto_id, null, v_almacen_id, v_fila.stock_teorico, v_fila.stock_real, p_cerrada_por);
    else
      if v_fila.stock_teorico > 0.01 then
        v_factor := (v_fila.stock_teorico + v_fila.diferencia) / v_fila.stock_teorico;

        -- IMPORTANTE: v_total_comp/v_null_actual se calculan ANTES de
        -- insertar cualquier ajuste nuevo. stock_lote_por_producto() es una
        -- vista en vivo sobre ajustes_inventario — si se calculara después
        -- del loop (que ya insertó filas), leería su propio resultado a
        -- mitad de transacción y el residuo "sin desglose" saldría mal.
        select coalesce(sum(stock), 0) into v_total_comp
          from public.stock_lote_por_producto(v_fila.lote_id);
        v_null_actual := v_fila.stock_teorico - v_total_comp;

        for v_comp in select * from public.stock_lote_por_producto(v_fila.lote_id)
        loop
          if abs(v_comp.stock) > 0.0001 then
            insert into public.ajustes_inventario
              (toma_fisica_id, producto_id, lote_id, almacen_id, stock_teorico, stock_real, registrado_por)
            values (
              p_toma_fisica_id, v_comp.producto_id, v_fila.lote_id, v_almacen_id,
              v_comp.stock, v_comp.stock * v_factor, p_cerrada_por
            );
          end if;
        end loop;

        if abs(v_null_actual) > 0.01 then
          insert into public.ajustes_inventario
            (toma_fisica_id, producto_id, lote_id, almacen_id, stock_teorico, stock_real, registrado_por)
          values (
            p_toma_fisica_id, null, v_fila.lote_id, v_almacen_id,
            v_null_actual, v_null_actual * v_factor, p_cerrada_por
          );
        end if;
      else
        insert into public.ajustes_inventario
          (toma_fisica_id, producto_id, lote_id, almacen_id, stock_teorico, stock_real, registrado_por)
        values (p_toma_fisica_id, null, v_fila.lote_id, v_almacen_id, v_fila.stock_teorico, v_fila.stock_real, p_cerrada_por);
      end if;
    end if;
  end loop;

  update public.tomas_fisicas_inventario
     set estado = 'cerrada',
         cerrada_por = p_cerrada_por,
         cerrada_en = now(),
         snapshot_resumen = v_snapshot
   where id = p_toma_fisica_id;
end;
$function$;
