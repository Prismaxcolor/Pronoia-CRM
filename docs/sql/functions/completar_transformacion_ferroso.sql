-- Extraído de producción vía pg_get_functiondef, 11-sep-2026
-- Args: p_transformacion_id uuid, p_salidas jsonb, p_completado_por uuid

CREATE OR REPLACE FUNCTION public.completar_transformacion_ferroso(p_transformacion_id uuid, p_salidas jsonb, p_completado_por uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  s                    jsonb;
  v_peso_neto_entrada  numeric;
  v_suma_salidas       numeric := 0;
  v_peso_bruto         numeric;
  v_tara               numeric;
  v_fotos              text[];
begin
  select t.peso_neto into v_peso_neto_entrada
  from public.transformaciones t
  where t.id = p_transformacion_id and t.estado = 'bruto' and t.categoria = 'ferroso_no_ferroso'
  for update;

  if v_peso_neto_entrada is null then
    raise exception 'Transformación no encontrada o ya está completa.';
  end if;

  if jsonb_array_length(p_salidas) = 0 then
    raise exception 'Agrega al menos una salida.';
  end if;

  for s in select * from jsonb_array_elements(p_salidas) loop
    if not (s ? 'fotos') or jsonb_array_length(s->'fotos') = 0 then
      raise exception 'Cada salida necesita al menos una foto.';
    end if;
    v_peso_bruto := (s->>'peso_bruto')::numeric;
    v_tara := coalesce((s->>'tara')::numeric, 0);
    if v_peso_bruto - v_tara <= 0 then
      raise exception 'El peso neto de cada salida debe ser mayor a 0.';
    end if;
    v_suma_salidas := v_suma_salidas + (v_peso_bruto - v_tara);
  end loop;

  if v_suma_salidas > v_peso_neto_entrada + 0.01 then
    raise exception 'La suma de las salidas (%) supera el peso neto de entrada (%).',
      round(v_suma_salidas, 2), round(v_peso_neto_entrada, 2);
  end if;

  for s in select * from jsonb_array_elements(p_salidas) loop
    v_fotos := coalesce(array(select jsonb_array_elements_text(s->'fotos')), '{}');
    insert into public.transformacion_salida_detalle (
      transformacion_id, producto_id, lote_destino_id, peso_bruto, tara, fotos
    ) values (
      p_transformacion_id,
      (s->>'producto_id')::uuid,
      null,
      (s->>'peso_bruto')::numeric,
      coalesce((s->>'tara')::numeric, 0),
      v_fotos
    );
  end loop;

  update public.transformaciones
  set estado = 'completa', completado_por = p_completado_por, completado_en = now()
  where id = p_transformacion_id;
end;
$function$
;
