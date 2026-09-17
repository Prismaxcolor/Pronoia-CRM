-- Extraído de producción vía pg_get_functiondef, 11-sep-2026
-- Args: p_ticket_id uuid, p_materiales jsonb, p_peso_global numeric, p_observaciones text, p_devolucion numeric, p_fotos_devolucion text[]

CREATE OR REPLACE FUNCTION public.editar_ticket_pesaje(p_ticket_id uuid, p_materiales jsonb, p_peso_global numeric DEFAULT NULL::numeric, p_observaciones text DEFAULT NULL::text, p_devolucion numeric DEFAULT NULL::numeric, p_fotos_devolucion text[] DEFAULT NULL::text[])
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_estado    text;
  v_tipo      text;
  v_facturado boolean;
  v_item      jsonb;
  v_pesaje_exterior boolean;
  v_peso_global_actual numeric;
  v_almacen_id uuid;
  v_devolucion_actual numeric;
  v_devolucion numeric;
  v_fotos_devolucion_actual text[];
  v_fotos_devolucion_final text[];
  v_peso_neto_materiales numeric;
  v_diferencia numeric;
begin
  select estado, tipo, facturado, pesaje_exterior, peso_global, devolucion, almacen_id, coalesce(fotos_devolucion, '{}')
    into v_estado, v_tipo, v_facturado, v_pesaje_exterior, v_peso_global_actual, v_devolucion_actual, v_almacen_id, v_fotos_devolucion_actual
    from public.tickets_pesaje where id = p_ticket_id;

  if v_estado is null then
    raise exception 'Ticket no encontrado.';
  end if;
  if v_estado <> 'completo' then
    raise exception 'Solo se pueden editar tickets completos (usa completar_ticket_pesaje para uno en bruto).';
  end if;
  if v_facturado then
    raise exception 'No se puede editar un ticket ya facturado.';
  end if;

  v_devolucion := coalesce(p_devolucion, v_devolucion_actual, 0);
  v_fotos_devolucion_final := coalesce(p_fotos_devolucion, v_fotos_devolucion_actual);

  for v_item in select value from jsonb_array_elements(coalesce(p_materiales, '[]'::jsonb)) as elems(value)
  loop
    if public.hay_toma_fisica_abierta(v_almacen_id, (v_item->>'producto_id')::uuid, nullif(v_item->>'lote_id', '')::uuid) then
      raise exception 'Hay una toma física de inventario abierta para uno de estos materiales. No se pueden editar pesajes hasta cerrarla.';
    end if;
    if not (v_item ? 'fotos') or jsonb_array_length(v_item->'fotos') = 0 then
      raise exception 'Cada material necesita al menos una foto.';
    end if;
  end loop;

  if v_devolucion > 0 and (v_fotos_devolucion_final is null or array_length(v_fotos_devolucion_final, 1) is null) then
    raise exception 'Agrega al menos una foto de la devolución.';
  end if;

  if not coalesce(v_pesaje_exterior, false) then
    select coalesce(sum((value->>'peso_bruto')::numeric - (value->>'tara')::numeric), 0)
      into v_peso_neto_materiales
    from jsonb_array_elements(coalesce(p_materiales, '[]'::jsonb)) as elems(value);

    v_diferencia := coalesce(coalesce(p_peso_global, v_peso_global_actual), 0) - v_peso_neto_materiales - v_devolucion;
    if v_diferencia < -0.01 then
      raise exception 'La suma de materiales + devolucion supera el peso global. Eso favorece al proveedor. Revisa los pesos antes de guardar.';
    end if;
  end if;

  update public.tickets_pesaje
     set peso_global   = coalesce(p_peso_global, peso_global),
         observaciones = coalesce(nullif(p_observaciones, ''), observaciones),
         devolucion    = coalesce(p_devolucion, devolucion),
         fotos_devolucion = coalesce(p_fotos_devolucion, fotos_devolucion)
   where id = p_ticket_id;

  delete from public.detalle_tickets_pesaje where ticket_id = p_ticket_id;

  -- Se valida DESPUÉS de borrar las filas viejas del propio ticket, para no
  -- contar la venta anterior de este mismo ticket como si compitiera contra sí misma.
  perform public.validar_stock_venta(v_tipo, p_materiales, v_almacen_id);

  for v_item in select value from jsonb_array_elements(p_materiales) as elems(value)
  loop
    insert into public.detalle_tickets_pesaje
      (ticket_id, producto_id, subcategoria, peso_bruto, tara, devolucion, destino_tipo, lote_id, fotos)
    values (
      p_ticket_id,
      (v_item->>'producto_id')::uuid,
      nullif(v_item->>'subcategoria', ''),
      (v_item->>'peso_bruto')::numeric,
      (v_item->>'tara')::numeric,
      coalesce((v_item->>'devolucion')::numeric, 0),
      coalesce(nullif(v_item->>'destino_tipo', ''), 'mpp'),
      nullif(v_item->>'lote_id', '')::uuid,
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(v_item->'fotos', '[]'::jsonb)) as x), '{}')
    );
  end loop;

  return p_ticket_id;
end;
$function$
;
