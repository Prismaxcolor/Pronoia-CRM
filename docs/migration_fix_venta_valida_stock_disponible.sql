-- =============================================================================
-- MIGRACIÓN: Las ventas (tickets de pesaje tipo 'venta') ahora validan que el
--            lote y el almacén realmente tengan el material antes de dejar
--            completar/editar el ticket. Antes no había ningún límite.
--
-- PROBLEMA (mismo patrón que ya se corrigió para transformaciones el
-- 07/09-sep-2026, repetido en otro punto del sistema): crear_ticket_pesaje(),
-- completar_ticket_pesaje() y editar_ticket_pesaje() insertan filas en
-- detalle_tickets_pesaje (que es la fuente cruda de la que se calculan
-- stock_lote_por_producto/stock_lote_total/stock_almacen) sin verificar en
-- ningún momento que el lote o el almacén tengan esa cantidad del material
-- que se está vendiendo. crear_transformacion()/crear_transformacion_pcb() sí
-- validan contra stock_lote_total() antes de dejar transformar — pero vender
-- de un lote (o de un almacén) más material del que existe físicamente
-- siempre estuvo permitido, sin aviso. Eso deja stock_lote_por_producto()
-- en negativo para ese producto — y como composicion_lote() sólo muestra
-- productos con stock > 0, el producto sobrevendido simplemente desaparece
-- de la composición mostrada, y el % de los demás productos del lote se
-- recalcula mal (ya no sobre 100% real). Esto es exactamente el síntoma
-- reportado: "quiero transformar un lote y dice que tiene una cantidad de
-- kilogramos y componentes que no corresponden a la realidad".
--
-- FIX: nueva función validar_stock_venta() — para tickets tipo 'venta',
-- antes de insertar/reemplazar el desglose del ticket:
--   1. Por lote: si el material se descuenta de un lote específico
--      (destino_tipo='lote'), no puede superar stock_lote_por_producto()
--      de ese lote+producto.
--   2. Por almacén: la venta total de un producto (venga o no de un lote
--      puntual) no puede superar stock_almacen() del almacén del ticket.
-- Se llama desde crear_ticket_pesaje(), completar_ticket_pesaje() y
-- editar_ticket_pesaje() (en editar, DESPUÉS de borrar las filas viejas del
-- propio ticket, para no contarlas dos veces contra sí mismas).
--
-- LIMPIEZA: de paso se eliminan los overloads huérfanos de estas 3 funciones
-- (versiones con menos parámetros de antes de que se agregaran devolución,
-- fotos de devolución y pesajes globales) — el backend solo llama a la
-- versión con todos los parámetros; las viejas nunca se invocan y son un
-- riesgo de que Postgres resuelva a la función equivocada en el futuro.
--
-- CÓMO APLICAR: pegar en Supabase Studio → SQL Editor y ejecutar.
-- =============================================================================

create or replace function public.validar_stock_venta(p_tipo text, p_materiales jsonb, p_almacen_id uuid)
returns void
language plpgsql
as $$
declare
  v_lote_check   record;
  v_prod_check   record;
  v_stock_lote   numeric;
  v_stock_almacen numeric;
begin
  if p_tipo <> 'venta' then
    return;
  end if;

  -- Por lote: no se puede vender de un lote más de lo que ese lote tiene de ese producto.
  for v_lote_check in
    select (m->>'lote_id')::uuid as lote_id,
           (m->>'producto_id')::uuid as producto_id,
           sum((m->>'peso_bruto')::numeric - coalesce((m->>'tara')::numeric, 0)) as kg
    from jsonb_array_elements(coalesce(p_materiales, '[]'::jsonb)) as elems(m)
    where coalesce(nullif(m->>'destino_tipo', ''), 'mpp') = 'lote'
      and nullif(m->>'lote_id', '') is not null
    group by 1, 2
  loop
    select coalesce(stock, 0) into v_stock_lote
      from public.stock_lote_por_producto(v_lote_check.lote_id)
     where producto_id = v_lote_check.producto_id;

    if v_lote_check.kg > coalesce(v_stock_lote, 0) + 0.01 then
      raise exception 'Solo hay % kg de este material disponibles en el lote seleccionado (intentas vender %).',
        round(coalesce(v_stock_lote, 0), 2), round(v_lote_check.kg, 2);
    end if;
  end loop;

  -- Por almacén: la venta total de un producto no puede superar el stock del almacén.
  for v_prod_check in
    select (m->>'producto_id')::uuid as producto_id,
           sum((m->>'peso_bruto')::numeric - coalesce((m->>'tara')::numeric, 0)) as kg
    from jsonb_array_elements(coalesce(p_materiales, '[]'::jsonb)) as elems(m)
    group by 1
  loop
    select coalesce(stock, 0) into v_stock_almacen
      from public.stock_almacen(p_almacen_id)
     where producto_id = v_prod_check.producto_id;

    if v_prod_check.kg > coalesce(v_stock_almacen, 0) + 0.01 then
      raise exception 'Solo hay % kg de este material disponibles en el almacén (intentas vender %).',
        round(coalesce(v_stock_almacen, 0), 2), round(v_prod_check.kg, 2);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- crear_ticket_pesaje (versión de 13 parámetros, la única que usa el backend)
-- ---------------------------------------------------------------------------
create or replace function public.crear_ticket_pesaje(
  p_tipo text, p_entidad_id uuid, p_fecha date, p_fotos text[], p_observaciones text,
  p_materiales jsonb, p_estado text, p_pesado_por uuid, p_peso_global numeric,
  p_devolucion numeric default 0, p_pesaje_exterior boolean default false,
  p_fotos_devolucion text[] default '{}'::text[], p_pesajes_globales jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_id         uuid;
  v_item       jsonb;
  v_almacen_id uuid;
  v_numero     integer;
  v_estado     text;
  v_peso_neto_materiales numeric;
  v_diferencia numeric;
begin
  select id into v_almacen_id
    from public.almacenes
   where es_predeterminado and activo
   limit 1;

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
     peso_global, devolucion, almacen_id, numero, pesaje_exterior, fotos_devolucion)
  values (
    p_tipo, p_entidad_id, p_fecha, p_fotos, nullif(p_observaciones, ''),
    v_estado, p_pesado_por, p_peso_global,
    coalesce(p_devolucion, 0), v_almacen_id, v_numero,
    coalesce(p_pesaje_exterior, false), coalesce(p_fotos_devolucion, '{}')
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
$$;

-- ---------------------------------------------------------------------------
-- completar_ticket_pesaje (versión de 5 parámetros, la única que usa el backend)
-- ---------------------------------------------------------------------------
create or replace function public.completar_ticket_pesaje(
  p_ticket_id uuid, p_materiales jsonb, p_completado_por uuid,
  p_devolucion numeric default null::numeric, p_fotos_devolucion text[] default null::text[]
)
returns uuid
language plpgsql
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- editar_ticket_pesaje (versión de 6 parámetros, la única que usa el backend)
-- ---------------------------------------------------------------------------
create or replace function public.editar_ticket_pesaje(
  p_ticket_id uuid, p_materiales jsonb, p_peso_global numeric default null::numeric,
  p_observaciones text default null::text, p_devolucion numeric default null::numeric,
  p_fotos_devolucion text[] default null::text[]
)
returns uuid
language plpgsql
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- Limpieza: overloads huérfanos que el backend nunca llama (versiones viejas,
-- de antes de agregar devolución / fotos de devolución / pesajes globales).
-- ---------------------------------------------------------------------------
drop function if exists public.crear_ticket_pesaje(text, uuid, date, text[], text, jsonb, text, uuid, numeric, numeric, boolean);
drop function if exists public.crear_ticket_pesaje(text, uuid, date, text[], text, jsonb, text, uuid, numeric, numeric, boolean, text[]);
drop function if exists public.completar_ticket_pesaje(uuid, jsonb, uuid);
drop function if exists public.completar_ticket_pesaje(uuid, jsonb, uuid, numeric);
drop function if exists public.editar_ticket_pesaje(uuid, jsonb, numeric, text);
drop function if exists public.editar_ticket_pesaje(uuid, jsonb, numeric, text, numeric);

-- VERIFICACIÓN RÁPIDA (descomentar para comprobar antes de aplicar):
-- select public.validar_stock_venta('venta',
--   '[{"producto_id":"<uuid>","peso_bruto":999999,"tara":0,"destino_tipo":"lote","lote_id":"<uuid de un lote real>"}]'::jsonb,
--   (select id from public.almacenes where es_predeterminado and activo limit 1)
-- ); -- debe lanzar excepción "Solo hay X kg..."
