-- =============================================================================
-- MIGRACIÓN: cierra un hueco del fix de emergencia de hoy
--            (migration_remove_bloqueos_stock_insuficiente.sql, 11-sep-2026).
--
-- Ese fix quitó el bloqueo por "stock insuficiente" de crear_transformacion()
-- (legacy, retira de lote-pool) — pero esa función NO es la que usa el
-- frontend. El frontend llama /api/transformaciones/pcb, que usa
-- crear_transformacion_pcb(), una función distinta que seguía con el mismo
-- bloqueo ("Solo hay % kg disponibles en %."). Julio seguía bloqueado para
-- transformar lotes PCB después del fix de hoy — encontrado en la auditoría
-- del plan de consolidación (docs/PLAN_consolidacion_inventario.md, RC-3).
--
-- Mismo tratamiento que ya recibió crear_transformacion(): se quita el
-- bloqueo, y si el lote ya está en 0 o negativo, todo el peso retirado se
-- registra como "sin clasificar" (producto_id=null) en vez de dividir por
-- un total disponible que podría ser 0.
--
-- Se deja INTACTA la validación de completar_transformacion_pcb() de que
-- las salidas no pueden superar el peso neto de la entrada — es
-- conservación de masa dentro de UNA transformación puntual, no un bloqueo
-- por falta de stock (mismo criterio que ya se aplicó a ferroso/no-ferroso).
--
-- CÓMO APLICAR: pegar en Supabase Studio → SQL Editor y ejecutar.
-- =============================================================================

create or replace function public.crear_transformacion_pcb(p_lote_origen_id uuid, p_peso_bruto numeric, p_tara numeric, p_fecha date, p_notas text, p_fotos_entrada text[], p_registrado_por uuid)
returns uuid
language plpgsql
as $$
declare
  v_id               uuid;
  v_neto             numeric;
  v_total_disponible numeric;
  v_total_distribuido numeric := 0;
  v_prod             record;
  v_prod_kg          numeric;
  v_null_kg          numeric;
  v_nombre_lote      text;
begin
  select nombre into v_nombre_lote from public.lotes where id = p_lote_origen_id for update;
  if v_nombre_lote is null then
    raise exception 'Lote origen % no encontrado.', p_lote_origen_id;
  end if;

  v_neto := coalesce(p_peso_bruto, 0) - coalesce(p_tara, 0);
  if v_neto <= 0 then
    raise exception 'El peso neto de entrada debe ser mayor a 0.';
  end if;
  if p_fotos_entrada is null or array_length(p_fotos_entrada, 1) is null then
    raise exception 'Agrega al menos una foto de entrada.';
  end if;

  v_total_disponible := public.stock_lote_total(p_lote_origen_id);

  insert into public.transformaciones
    (categoria, lote_origen_id, peso_bruto, tara, fecha, estado, notas, fotos_entrada, registrado_por)
  values
    ('pcb', p_lote_origen_id, p_peso_bruto, coalesce(p_tara, 0), coalesce(p_fecha, current_date),
     'bruto', nullif(p_notas, ''), p_fotos_entrada, p_registrado_por)
  returning id into v_id;

  if v_total_disponible > 0 then
    for v_prod in
      select producto_id, stock from public.stock_lote_por_producto(p_lote_origen_id) where stock > 0
    loop
      v_prod_kg := round(v_neto * v_prod.stock / v_total_disponible, 4);
      if v_prod_kg > 0 then
        insert into public.transformacion_entrada_detalle (transformacion_id, producto_id, peso_kg)
        values (v_id, v_prod.producto_id, v_prod_kg);
        v_total_distribuido := v_total_distribuido + v_prod_kg;
      end if;
    end loop;
  end if;

  v_null_kg := round(v_neto - v_total_distribuido, 4);
  if v_null_kg > 0 then
    insert into public.transformacion_entrada_detalle (transformacion_id, producto_id, peso_kg)
    values (v_id, null, v_null_kg);
  end if;

  return v_id;
end;
$$;
