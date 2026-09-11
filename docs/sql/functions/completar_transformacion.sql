-- Extraído de producción vía pg_get_functiondef, 11-sep-2026
-- Args: p_transformacion_id uuid, p_salidas jsonb, p_completado_por uuid

CREATE OR REPLACE FUNCTION public.completar_transformacion(p_transformacion_id uuid, p_salidas jsonb, p_completado_por uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_estado             text;
  v_lote_origen_id     uuid;
  v_peso_neto_entrada  numeric;
  v_item               jsonb;
  v_suma_salidas       numeric := 0;
  v_peso_bruto         numeric;
  v_tara               numeric;
  v_neto               numeric;
  v_lote_destino       uuid;
begin
  select estado, lote_origen_id, peso_neto
    into v_estado, v_lote_origen_id, v_peso_neto_entrada
    from public.transformaciones
   where id = p_transformacion_id
     for update;

  if v_estado is null then
    raise exception 'Transformación % no encontrada.', p_transformacion_id;
  end if;
  if v_estado <> 'bruto' then
    raise exception 'Esta transformación ya fue completada.';
  end if;

  if p_salidas is null or jsonb_typeof(p_salidas) <> 'array' or jsonb_array_length(p_salidas) = 0 then
    raise exception 'Debe indicar al menos una salida.';
  end if;

  for v_item in select value from jsonb_array_elements(p_salidas) as elems(value)
  loop
    v_lote_destino := (v_item->>'lote_destino_id')::uuid;
    v_peso_bruto := (v_item->>'peso_bruto')::numeric;
    v_tara := coalesce((v_item->>'tara')::numeric, 0);
    v_neto := v_peso_bruto - v_tara;

    if v_lote_destino = v_lote_origen_id then
      raise exception 'El lote destino debe ser distinto del lote origen.';
    end if;
    if v_neto <= 0 then
      raise exception 'El peso neto de cada salida debe ser mayor a 0.';
    end if;
    if not exists (select 1 from public.lotes where id = v_lote_destino and activo) then
      raise exception 'Lote destino % no encontrado o archivado.', v_lote_destino;
    end if;

    v_suma_salidas := v_suma_salidas + v_neto;
  end loop;

  if v_suma_salidas > v_peso_neto_entrada + 0.01 then
    raise exception 'La suma de las salidas (%) supera el peso neto de entrada (%).',
      round(v_suma_salidas, 2), round(v_peso_neto_entrada, 2);
  end if;

  for v_item in select value from jsonb_array_elements(p_salidas) as elems(value)
  loop
    insert into public.transformacion_salida_detalle (transformacion_id, lote_destino_id, peso_bruto, tara)
    values (
      p_transformacion_id,
      (v_item->>'lote_destino_id')::uuid,
      (v_item->>'peso_bruto')::numeric,
      coalesce((v_item->>'tara')::numeric, 0)
    );
  end loop;

  update public.transformaciones
     set estado = 'completa', completado_por = p_completado_por, completado_en = now()
   where id = p_transformacion_id;

  return p_transformacion_id;
end;
$function$
;
