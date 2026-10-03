-- Extraído de producción vía pg_get_functiondef, 11-sep-2026
-- Args: p_traslado_id uuid, p_recepciones jsonb, p_fotos text[], p_completado_por uuid

CREATE OR REPLACE FUNCTION public.completar_traslado(p_traslado_id uuid, p_recepciones jsonb, p_fotos text[], p_completado_por uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_estado text;
  v_item   jsonb;
  v_fila   record;
  v_almacen_origen_id uuid;
  v_almacen_destino_id uuid;
  v_peso_neto numeric;
  v_peso_recibido numeric;
  v_nombre text;
begin
  -- Bloquea el ticket de traslado para que dos recepciones concurrentes del
  -- mismo traslado no pasen ambas la validación de estado 'pendiente'.
  select estado, almacen_origen_id, almacen_destino_id
    into v_estado, v_almacen_origen_id, v_almacen_destino_id
    from public.tickets_traslado where id = p_traslado_id
    for update;

  if v_estado is null then
    raise exception 'Traslado no encontrado.';
  end if;
  if v_estado <> 'pendiente' then
    raise exception 'El traslado ya está completo.';
  end if;

  for v_fila in select producto_id from public.detalle_traslado where traslado_id = p_traslado_id
  loop
    if public.hay_toma_fisica_abierta(v_almacen_origen_id, v_fila.producto_id)
       or public.hay_toma_fisica_abierta(v_almacen_destino_id, v_fila.producto_id) then
      raise exception 'Uno de los materiales tiene una toma física de inventario abierta en el origen o el destino. No se pueden recibir traslados hasta cerrarla.';
    end if;
  end loop;

  if p_fotos is null or array_length(p_fotos, 1) is null or array_length(p_fotos, 1) < 1 then
    raise exception 'La recepción requiere al menos una foto de evidencia.';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_recepciones, '[]'::jsonb)) as elems(value)
  loop
    select dt.peso_neto, p.nombre into v_peso_neto, v_nombre
      from public.detalle_traslado dt
      join public.productos p on p.id = dt.producto_id
     where dt.id = (v_item->>'detalle_id')::uuid and dt.traslado_id = p_traslado_id;

    if v_peso_neto is null then
      raise exception 'Detalle de traslado % no encontrado.', (v_item->>'detalle_id')::uuid;
    end if;

    v_peso_recibido := (v_item->>'peso_recibido')::numeric;
    if v_peso_recibido > v_peso_neto + 0.01 then
      raise exception 'No se puede recibir más de lo que salió: % kg despachados de %.', round(v_peso_neto, 2), coalesce(v_nombre, 'este material');
    end if;
    if v_peso_recibido < 0 then
      raise exception 'El peso recibido no puede ser negativo.';
    end if;

    update public.detalle_traslado
       set peso_recibido = v_peso_recibido
     where id = (v_item->>'detalle_id')::uuid
       and traslado_id = p_traslado_id;
  end loop;

  update public.tickets_traslado
     set estado         = 'completo',
         fotos           = p_fotos,
         completado_por  = p_completado_por,
         completado_en   = now()
   where id = p_traslado_id;

  return p_traslado_id;
end;
$function$
;
