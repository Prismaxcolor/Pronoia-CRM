-- Función NUEVA (no reemplaza completar_ticket_pesaje). Ver docs/migration_ticket_pesaje_unido.sql.
-- Args: p_ticket_id uuid, p_materiales jsonb, p_completado_por uuid, p_devolucion numeric, p_fotos_devolucion text[], p_tickets_unidos uuid[]

create or replace function public.completar_ticket_pesaje_unido(
  p_ticket_id uuid,
  p_materiales jsonb,
  p_completado_por uuid,
  p_devolucion numeric default null,
  p_fotos_devolucion text[] default null,
  p_tickets_unidos uuid[] default null
)
 returns uuid
 language plpgsql
as $function$
declare
  v_estado text;
  v_tipo   text;
  v_entidad_id uuid;
  v_item   jsonb;
  v_pesaje_exterior boolean;
  v_peso_global numeric;
  v_peso_global_total numeric;
  v_almacen_id uuid;
  v_devolucion_actual numeric;
  v_devolucion numeric;
  v_fotos_devolucion_final text[];
  v_peso_neto_materiales numeric;
  v_diferencia numeric;
  v_ids uuid[];
  v_cant_unidos integer;
  v_cant_validos integer;
  v_suma_unidos numeric;
begin
  if p_materiales is null or jsonb_typeof(p_materiales) <> 'array' or jsonb_array_length(p_materiales) = 0 then
    raise exception 'Agrega al menos un material.';
  end if;

  -- Tickets a unir: sin nulos ni repetidos.
  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_ids
    from unnest(coalesce(p_tickets_unidos, '{}'::uuid[])) as x
   where x is not null;
  v_cant_unidos := coalesce(array_length(v_ids, 1), 0);

  if v_cant_unidos = 0 then
    raise exception 'Indica al menos un ticket para unir (o usa completar_ticket_pesaje).';
  end if;
  if v_cant_unidos > 10 then
    raise exception 'No se pueden unir más de 10 tickets.';
  end if;
  if cardinality(p_tickets_unidos) <> v_cant_unidos then
    raise exception 'Hay tickets repetidos en la unión.';
  end if;
  if p_ticket_id = any(v_ids) then
    raise exception 'El ticket principal no puede unirse a sí mismo.';
  end if;

  -- Bloquea principal + secundarios en un solo SELECT ordenado por id: el
  -- orden único evita deadlocks entre dos uniones simultáneas.
  perform 1
    from public.tickets_pesaje
   where id = p_ticket_id or id = any(v_ids)
   order by id
     for update;

  select estado, tipo, entidad_id, pesaje_exterior, peso_global, devolucion, almacen_id
    into v_estado, v_tipo, v_entidad_id, v_pesaje_exterior, v_peso_global, v_devolucion_actual, v_almacen_id
    from public.tickets_pesaje where id = p_ticket_id;

  if v_estado is null then
    raise exception 'Ticket no encontrado.';
  end if;
  if v_estado <> 'bruto' then
    raise exception 'El ticket ya esta completo.';
  end if;
  if v_tipo <> 'compra' then
    raise exception 'Solo se pueden unir tickets de compra.';
  end if;
  if coalesce(v_pesaje_exterior, false) then
    raise exception 'Un ticket con pesaje exterior no admite unir otros tickets.';
  end if;

  -- Valida los secundarios (ya bloqueados): compra, en bruto, mismo proveedor y
  -- mismo almacén, con peso global propio > 0, sin devolución registrada y
  -- todavía no unidos a otro ticket.
  select count(*), coalesce(sum(peso_global), 0)
    into v_cant_validos, v_suma_unidos
    from public.tickets_pesaje
   where id = any(v_ids)
     and tipo = 'compra'
     and estado = 'bruto'
     and entidad_id is not distinct from v_entidad_id
     and almacen_id is not distinct from v_almacen_id
     and coalesce(pesaje_exterior, false) = false
     and coalesce(peso_global, 0) > 0
     and coalesce(devolucion, 0) = 0
     and ticket_principal_id is null;

  if v_cant_validos <> v_cant_unidos then
    raise exception 'Alguno de los tickets a unir no existe, no está en bruto, no es de compra, no es del mismo proveedor y almacén, no tiene peso global, tiene devolución registrada o ya está unido.';
  end if;

  v_peso_global_total := coalesce(v_peso_global, 0) + v_suma_unidos;

  v_devolucion := coalesce(p_devolucion, v_devolucion_actual, 0);
  select coalesce(fotos_devolucion, '{}') into v_fotos_devolucion_final from public.tickets_pesaje where id = p_ticket_id;
  v_fotos_devolucion_final := coalesce(p_fotos_devolucion, v_fotos_devolucion_final);

  for v_item in select value from jsonb_array_elements(p_materiales) as elems(value)
  loop
    if public.hay_toma_fisica_abierta(v_almacen_id, (v_item->>'producto_id')::uuid, nullif(v_item->>'lote_id', '')::uuid) then
      raise exception 'Hay una toma física de inventario abierta para uno de estos materiales. No se pueden registrar pesajes hasta cerrarla.';
    end if;
    if not (v_item ? 'fotos') or jsonb_array_length(v_item->'fotos') = 0 then
      raise exception 'Cada material necesita al menos una foto.';
    end if;
  end loop;

  if v_devolucion > 0 and (v_fotos_devolucion_final is null or array_length(v_fotos_devolucion_final, 1) is null) then
    raise exception 'Agrega al menos una foto de la devolución.';
  end if;

  select coalesce(sum((value->>'peso_bruto')::numeric - (value->>'tara')::numeric), 0)
    into v_peso_neto_materiales
  from jsonb_array_elements(p_materiales) as elems(value);

  v_diferencia := v_peso_global_total - v_peso_neto_materiales - v_devolucion;
  if v_diferencia < -0.01 then
    raise exception 'La suma de materiales + devolucion supera el peso global. Eso favorece al proveedor. Revisa los pesos antes de guardar.';
  end if;

  perform public.validar_stock_venta(v_tipo, p_materiales, v_almacen_id);

  -- El detalle (y por tanto el stock) se registra una sola vez, en el principal.
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

  -- El principal pasa a representar el pesaje global total (suma). Los pesos
  -- originales quedan en cada secundario (peso_global propio) y en
  -- pesajes_globales, así que el peso original del principal es
  -- peso_global - sum(peso_global de sus secundarios).
  update public.tickets_pesaje
     set estado = 'completo',
         completado_por = p_completado_por,
         completado_en = now(),
         peso_global = v_peso_global_total,
         devolucion = coalesce(p_devolucion, devolucion),
         fotos_devolucion = coalesce(p_fotos_devolucion, fotos_devolucion)
   where id = p_ticket_id;

  -- Secundarios: completos, enlazados al principal, sin detalle ni stock propio.
  update public.tickets_pesaje
     set estado = 'completo',
         completado_por = p_completado_por,
         completado_en = now(),
         ticket_principal_id = p_ticket_id
   where id = any(v_ids);

  return p_ticket_id;
end;
$function$
;

-- Solo el backend (service_role) debe poder invocarla.
revoke execute on function public.completar_ticket_pesaje_unido(uuid, jsonb, uuid, numeric, text[], uuid[]) from public, anon;
