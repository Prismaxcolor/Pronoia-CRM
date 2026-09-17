-- Extraído de producción vía pg_get_functiondef, 11-sep-2026
-- Args: p_almacen_origen_id uuid, p_almacen_destino_id uuid, p_observaciones text, p_materiales jsonb, p_pesado_por uuid

CREATE OR REPLACE FUNCTION public.crear_traslado(p_almacen_origen_id uuid, p_almacen_destino_id uuid, p_observaciones text, p_materiales jsonb, p_pesado_por uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_id   uuid;
  v_item jsonb;
begin
  if p_almacen_origen_id = p_almacen_destino_id then
    raise exception 'El almacén de origen y destino no pueden ser el mismo.';
  end if;

  -- Bloquea el almacén de origen para que dos traslados concurrentes no
  -- pisen el mismo cálculo de stock a mitad de camino (no es una
  -- validación de cantidad disponible, es control de concurrencia).
  perform 1 from public.almacenes where id = p_almacen_origen_id for update;

  for v_item in select value from jsonb_array_elements(coalesce(p_materiales, '[]'::jsonb)) as elems(value)
  loop
    if public.hay_toma_fisica_abierta(p_almacen_origen_id, (v_item->>'producto_id')::uuid)
       or public.hay_toma_fisica_abierta(p_almacen_destino_id, (v_item->>'producto_id')::uuid) then
      raise exception 'Uno de los materiales tiene una toma física de inventario abierta en el origen o el destino. No se pueden registrar traslados hasta cerrarla.';
    end if;
  end loop;

  insert into public.tickets_traslado
    (almacen_origen_id, almacen_destino_id, observaciones, pesado_por)
  values (
    p_almacen_origen_id, p_almacen_destino_id, nullif(p_observaciones, ''), p_pesado_por
  )
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_materiales, '[]'::jsonb)) as elems(value)
  loop
    insert into public.detalle_traslado
      (traslado_id, producto_id, subcategoria, peso_bruto, tara)
    values (
      v_id,
      (v_item->>'producto_id')::uuid,
      nullif(v_item->>'subcategoria', ''),
      (v_item->>'peso_bruto')::numeric,
      (v_item->>'tara')::numeric
    );
  end loop;

  return v_id;
end;
$function$
;
