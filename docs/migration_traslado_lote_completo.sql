-- =============================================================================
-- Punto 2.1 del plan de mejoras (sep-2026): traslado de un LOTE completo (PCB)
-- entre almacenes, no solo material sin lote (ferroso/no-ferroso/aluminio).
--
-- Diseño (decisión de producto, no parcial):
--   - Se traslada el lote COMPLETO, no una porción — coherente con que un
--     lote es una unidad física (ej. un pallet/bolsón), no algo que se pesa
--     de nuevo cada vez que se mueve.
--   - A diferencia del material sin lote (que descuenta del origen desde que
--     el traslado se CREA), el lote sigue apareciendo en su almacén de
--     origen mientras el traslado está 'pendiente' — recién se atribuye al
--     almacén destino cuando el traslado se COMPLETA (se recibe). Esto evita
--     tener que volver nullable lotes.almacen_id (cambio mucho más invasivo)
--     y es más intuitivo para un activo discreto: el lote sigue estando
--     físicamente donde estaba hasta que alguien confirma que llegó.
--   - stock_almacen() ya atribuye el lote a `lotes.almacen_id` actual (Fase 3
--     del plan de consolidación) — no hace falta tocar esa función, alcanza
--     con actualizar `lotes.almacen_id` al completar el traslado.
--
-- CÓMO APLICAR: pegar en Supabase Studio → SQL Editor y ejecutar.
-- =============================================================================

alter table public.detalle_traslado
  add column if not exists lote_id uuid references public.lotes(id);

-- Cambia la firma (nuevo parámetro) — DROP explícito de la versión anterior
-- para no dejar dos overloads ambiguos (mismo patrón que en las migraciones
-- anteriores de esta sesión).
drop function if exists public.crear_traslado(uuid, uuid, text, jsonb, uuid, text[]);

create or replace function public.crear_traslado(
  p_almacen_origen_id  uuid,
  p_almacen_destino_id uuid,
  p_observaciones      text,
  p_materiales         jsonb,
  p_pesado_por         uuid,
  p_fotos              text[] DEFAULT '{}'::text[],
  p_lote_ids           uuid[] DEFAULT '{}'::uuid[]
) returns uuid
language plpgsql
as $function$
declare
  v_id      uuid;
  v_item    jsonb;
  v_lote_id uuid;
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

  -- Lotes a trasladar completos: deben existir, estar activos, estar HOY en
  -- el almacén de origen, y no tener ya otro traslado pendiente encima
  -- (evita que el mismo lote quede "prometido" a dos destinos a la vez).
  if p_lote_ids is not null then
    foreach v_lote_id in array p_lote_ids
    loop
      if not exists (
        select 1 from public.lotes
        where id = v_lote_id and almacen_id = p_almacen_origen_id and activo
      ) then
        raise exception 'Uno de los lotes seleccionados no está activo en el almacén de origen.';
      end if;
      if exists (
        select 1
        from public.detalle_traslado dt
        join public.tickets_traslado t on t.id = dt.traslado_id
        where dt.lote_id = v_lote_id and t.estado = 'pendiente'
      ) then
        raise exception 'Uno de los lotes seleccionados ya tiene un traslado pendiente.';
      end if;
    end loop;
  end if;

  insert into public.tickets_traslado
    (almacen_origen_id, almacen_destino_id, observaciones, pesado_por, fotos)
  values (
    p_almacen_origen_id, p_almacen_destino_id, nullif(p_observaciones, ''), p_pesado_por,
    coalesce(p_fotos, '{}')
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

  -- Cada lote entra como una línea propia: peso_bruto = su stock total al
  -- momento de crear el traslado (snapshot para el historial), tara 0.
  if p_lote_ids is not null then
    foreach v_lote_id in array p_lote_ids
    loop
      insert into public.detalle_traslado (traslado_id, lote_id, peso_bruto, tara)
      values (v_id, v_lote_id, coalesce(public.stock_lote_total(v_lote_id), 0), 0);
    end loop;
  end if;

  return v_id;
end;
$function$;

create or replace function public.completar_traslado(
  p_traslado_id      uuid,
  p_recepciones      jsonb,
  p_fotos            text[],
  p_completado_por   uuid
) returns uuid
language plpgsql
as $function$
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

  for v_fila in select producto_id from public.detalle_traslado where traslado_id = p_traslado_id and producto_id is not null
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
    -- LEFT JOIN a productos (antes era INNER): una línea de lote no tiene
    -- producto_id y el INNER JOIN la perdía por completo, disparando
    -- siempre "Detalle de traslado no encontrado" para esas líneas.
    select dt.peso_neto, coalesce(p.nombre, l.nombre) into v_peso_neto, v_nombre
      from public.detalle_traslado dt
      left join public.productos p on p.id = dt.producto_id
      left join public.lotes l on l.id = dt.lote_id
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

  -- Los lotes trasladados completos pasan a pertenecer al almacén destino
  -- recién ahora — mientras estaba 'pendiente' seguían atribuidos al origen
  -- (ver nota de diseño en la migración que agregó lote_id).
  update public.lotes
     set almacen_id = v_almacen_destino_id
   where id in (select lote_id from public.detalle_traslado where traslado_id = p_traslado_id and lote_id is not null);

  update public.tickets_traslado
     set estado         = 'completo',
         fotos           = p_fotos,
         completado_por  = p_completado_por,
         completado_en   = now()
   where id = p_traslado_id;

  return p_traslado_id;
end;
$function$;
