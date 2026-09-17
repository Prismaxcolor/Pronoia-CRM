-- Extraído de producción vía pg_get_functiondef, 11-sep-2026
-- Args: p_toma_fisica_id uuid, p_cerrada_por uuid

CREATE OR REPLACE FUNCTION public.culminar_toma_fisica_inventario(p_toma_fisica_id uuid, p_cerrada_por uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
  -- Bloquea la toma física (evita doble-culminación concurrente) y el
  -- almacén asociado (serializa contra crear_traslado del mismo almacén).
  select estado, almacen_id into v_estado, v_almacen_id
    from public.tomas_fisicas_inventario where id = p_toma_fisica_id
    for update;

  if v_estado is null then
    raise exception 'Toma física no encontrada.';
  end if;
  if v_estado <> 'abierta' then
    raise exception 'Esta toma física ya está cerrada.';
  end if;

  perform 1 from public.almacenes where id = v_almacen_id for update;

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
      -- Bloquea el lote antes de leer su composición en vivo — mismo
      -- patrón que crear_transformacion/crear_transformacion_pcb, para que
      -- una transformación concurrente sobre este mismo lote no cambie la
      -- composición a mitad de este cálculo.
      perform 1 from public.lotes where id = v_fila.lote_id for update;

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
$function$
;
