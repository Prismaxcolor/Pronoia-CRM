-- ROLLBACK de docs/migration_taras_detalle_ticket.sql: restaura las 4 funciones
-- a su definición anterior (sin taras_detalle) y elimina la columna.
-- Se pierde el desglose guardado (la tara total sigue en `tara`).

CREATE OR REPLACE FUNCTION public.completar_ticket_pesaje(p_ticket_id uuid, p_materiales jsonb, p_completado_por uuid, p_devolucion numeric DEFAULT NULL::numeric, p_fotos_devolucion text[] DEFAULT NULL::text[])
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_estado text;
  v_tipo   text;
  v_item   jsonb;
  v_pesaje_exterior boolean;
  v_peso_global numeric;
  v_almacen_id uuid;
  v_devolucion_actual numeric;
  v_devolucion numeric;
  v_fotos_devolucion_final text[];
  v_peso_neto_materiales numeric;
  v_diferencia numeric;
begin
  select estado, tipo, pesaje_exterior, peso_global, devolucion, almacen_id
    into v_estado, v_tipo, v_pesaje_exterior, v_peso_global, v_devolucion_actual, v_almacen_id
    from public.tickets_pesaje where id = p_ticket_id;

  if v_estado is null then
    raise exception 'Ticket no encontrado.';
  end if;
  if v_estado <> 'bruto' then
    raise exception 'El ticket ya esta completo.';
  end if;

  v_devolucion := coalesce(p_devolucion, v_devolucion_actual, 0);
  select coalesce(fotos_devolucion, '{}') into v_fotos_devolucion_final from public.tickets_pesaje where id = p_ticket_id;
  v_fotos_devolucion_final := coalesce(p_fotos_devolucion, v_fotos_devolucion_final);

  for v_item in select value from jsonb_array_elements(coalesce(p_materiales, '[]'::jsonb)) as elems(value)
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

  if not coalesce(v_pesaje_exterior, false) then
    select coalesce(sum((value->>'peso_bruto')::numeric - (value->>'tara')::numeric), 0)
      into v_peso_neto_materiales
    from jsonb_array_elements(coalesce(p_materiales, '[]'::jsonb)) as elems(value);

    v_diferencia := coalesce(v_peso_global, 0) - v_peso_neto_materiales - v_devolucion;
    if v_diferencia < -0.01 then
      raise exception 'La suma de materiales + devolucion supera el peso global. Eso favorece al proveedor. Revisa los pesos antes de guardar.';
    end if;
  end if;

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

  update public.tickets_pesaje
     set estado = 'completo',
         completado_por = p_completado_por,
         completado_en = now(),
         devolucion = coalesce(p_devolucion, devolucion),
         fotos_devolucion = coalesce(p_fotos_devolucion, fotos_devolucion)
   where id = p_ticket_id;

  return p_ticket_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.completar_ticket_pesaje_unido(p_ticket_id uuid, p_materiales jsonb, p_completado_por uuid, p_devolucion numeric DEFAULT NULL::numeric, p_fotos_devolucion text[] DEFAULT NULL::text[], p_tickets_unidos uuid[] DEFAULT NULL::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.crear_ticket_pesaje(p_tipo text, p_entidad_id uuid, p_fecha date, p_fotos text[], p_observaciones text, p_materiales jsonb, p_estado text, p_pesado_por uuid, p_peso_global numeric, p_devolucion numeric DEFAULT 0, p_pesaje_exterior boolean DEFAULT false, p_fotos_devolucion text[] DEFAULT '{}'::text[], p_pesajes_globales jsonb DEFAULT '[]'::jsonb, p_almacen_id uuid DEFAULT NULL::uuid, p_vehiculo text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_id         uuid;
  v_item       jsonb;
  v_almacen_id uuid;
  v_numero     integer;
  v_estado     text;
  v_peso_neto_materiales numeric;
  v_diferencia numeric;
begin
  select coalesce(
    p_almacen_id,
    (select id from public.almacenes where es_predeterminado and activo limit 1)
  ) into v_almacen_id;

  v_estado := coalesce(p_estado, 'completo');

  for v_item in select value from jsonb_array_elements(coalesce(p_materiales, '[]'::jsonb)) as elems(value)
  loop
    if public.hay_toma_fisica_abierta(v_almacen_id, (v_item->>'producto_id')::uuid, nullif(v_item->>'lote_id', '')::uuid) then
      raise exception 'Hay una toma física de inventario abierta para uno de estos materiales. No se pueden registrar pesajes hasta cerrarla.';
    end if;
    if v_estado = 'completo' and (not (v_item ? 'fotos') or jsonb_array_length(v_item->'fotos') = 0) then
      raise exception 'Cada material necesita al menos una foto.';
    end if;
  end loop;

  if v_estado = 'completo' and coalesce(p_devolucion, 0) > 0
     and (p_fotos_devolucion is null or array_length(p_fotos_devolucion, 1) is null) then
    raise exception 'Agrega al menos una foto de la devolución.';
  end if;

  if v_estado = 'completo' and not coalesce(p_pesaje_exterior, false) then
    if exists (
      select 1 from jsonb_array_elements(coalesce(p_pesajes_globales, '[]'::jsonb)) as elems(value)
      where not (value ? 'fotos') or jsonb_array_length(value->'fotos') = 0
    ) then
      raise exception 'Cada pesaje global necesita al menos una foto.';
    end if;
  end if;

  if not coalesce(p_pesaje_exterior, false) and v_estado = 'completo' then
    select coalesce(sum((value->>'peso_bruto')::numeric - (value->>'tara')::numeric), 0)
      into v_peso_neto_materiales
    from jsonb_array_elements(coalesce(p_materiales, '[]'::jsonb)) as elems(value);

    v_diferencia := coalesce(p_peso_global, 0) - v_peso_neto_materiales - coalesce(p_devolucion, 0);
    if v_diferencia < -0.01 then
      raise exception 'La suma de materiales + devolucion supera el peso global. Eso favorece al proveedor. Revisa los pesos antes de guardar.';
    end if;
  end if;

  -- validar_stock_venta() ya es un no-op (migration_remove_bloqueos_stock_insuficiente.sql,
  -- 11-sep-2026) — se conserva la llamada para no tener que tocar esta
  -- función otra vez si algún día se decide mostrar un AVISO no bloqueante.
  if v_estado = 'completo' then
    perform public.validar_stock_venta(p_tipo, p_materiales, v_almacen_id);
  end if;

  if p_tipo = 'compra' then
    v_numero := nextval('public.tickets_pesaje_numero_compra_seq');
  else
    v_numero := nextval('public.tickets_pesaje_numero_venta_seq');
  end if;

  insert into public.tickets_pesaje
    (tipo, entidad_id, fecha, fotos, observaciones, estado, pesado_por,
     peso_global, devolucion, almacen_id, numero, pesaje_exterior, fotos_devolucion, vehiculo)
  values (
    p_tipo, p_entidad_id, p_fecha, p_fotos, nullif(p_observaciones, ''),
    v_estado, p_pesado_por, p_peso_global,
    coalesce(p_devolucion, 0), v_almacen_id, v_numero,
    coalesce(p_pesaje_exterior, false), coalesce(p_fotos_devolucion, '{}'),
    nullif(p_vehiculo, '')
  )
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_materiales, '[]'::jsonb)) as elems(value)
  loop
    insert into public.detalle_tickets_pesaje
      (ticket_id, producto_id, subcategoria, peso_bruto, tara, devolucion, destino_tipo, lote_id, fotos)
    values (
      v_id,
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

  insert into public.pesajes_globales (ticket_id, orden, peso, tara, fotos)
  select v_id, (ord - 1)::integer, (elem->>'peso')::numeric,
         coalesce((elem->>'tara')::numeric, 0), coalesce(elem->'fotos', '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_pesajes_globales, '[]'::jsonb)) with ordinality as t(elem, ord);

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.editar_ticket_pesaje(p_ticket_id uuid, p_materiales jsonb, p_peso_global numeric DEFAULT NULL::numeric, p_observaciones text DEFAULT NULL::text, p_devolucion numeric DEFAULT NULL::numeric, p_fotos_devolucion text[] DEFAULT NULL::text[], p_vehiculo text DEFAULT NULL::text, p_fecha date DEFAULT NULL::date, p_pesajes_globales jsonb DEFAULT NULL::jsonb, p_permitir_facturado boolean DEFAULT false)
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
  v_peso_global_final numeric;
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
  if v_facturado and not coalesce(p_permitir_facturado, false) then
    raise exception 'No se puede editar un ticket ya facturado.';
  end if;

  if p_pesajes_globales is not null then
    if coalesce(v_pesaje_exterior, false) then
      raise exception 'Este ticket no tiene pesaje global (báscula externa).';
    end if;
    if exists (select 1 from public.tickets_pesaje where ticket_principal_id = p_ticket_id) then
      raise exception 'Este ticket tiene tickets unidos: su pesaje global es la suma de todos y no se edita aquí.';
    end if;
    if jsonb_array_length(p_pesajes_globales) = 0 then
      raise exception 'Agrega al menos un pesaje global.';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_pesajes_globales) as elems(value)
      where not (value ? 'fotos') or jsonb_array_length(value->'fotos') = 0
    ) then
      raise exception 'Cada pesaje global necesita al menos una foto.';
    end if;
    select coalesce(sum((value->>'peso')::numeric - coalesce((value->>'tara')::numeric, 0)), 0)
      into v_peso_global_final
      from jsonb_array_elements(p_pesajes_globales) as elems(value);
  else
    v_peso_global_final := coalesce(p_peso_global, v_peso_global_actual);
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

    v_diferencia := coalesce(v_peso_global_final, 0) - v_peso_neto_materiales - v_devolucion;
    if v_diferencia < -0.01 then
      raise exception 'La suma de materiales + devolucion supera el peso global. Eso favorece al proveedor. Revisa los pesos antes de guardar.';
    end if;
  end if;

  update public.tickets_pesaje
     set peso_global   = case when coalesce(v_pesaje_exterior, false) then peso_global else coalesce(v_peso_global_final, peso_global) end,
         observaciones = coalesce(nullif(p_observaciones, ''), observaciones),
         devolucion    = coalesce(p_devolucion, devolucion),
         fotos_devolucion = coalesce(p_fotos_devolucion, fotos_devolucion),
         vehiculo      = coalesce(nullif(p_vehiculo, ''), vehiculo),
         fecha         = coalesce(p_fecha, fecha)
   where id = p_ticket_id;

  if p_pesajes_globales is not null then
    delete from public.pesajes_globales where ticket_id = p_ticket_id;
    insert into public.pesajes_globales (ticket_id, orden, peso, tara, fotos)
    select p_ticket_id, (ord - 1)::integer, (elem->>'peso')::numeric,
           coalesce((elem->>'tara')::numeric, 0), coalesce(elem->'fotos', '[]'::jsonb)
    from jsonb_array_elements(p_pesajes_globales) with ordinality as t(elem, ord);
  end if;

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
$function$;

alter table public.detalle_tickets_pesaje drop column if exists taras_detalle;
