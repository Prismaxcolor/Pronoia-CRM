-- =============================================================================
-- FASE 5 del plan de consolidación (docs/PLAN_consolidacion_inventario.md,
-- decisión P-1): crear_ticket_pesaje() acepta un almacén opcional.
--
-- Hasta hoy, TODA compra y venta se registraba siempre contra el almacén
-- "predeterminado" (es_predeterminado=true), sin importar dónde estuviera
-- realmente el material ni dejar elegirlo — la causa raíz del bloqueo de
-- venta de ALUMINIO DURO (500 kg reales en ALMACEN G1, la venta validaba
-- contra ALMACEN G2). Con el bloqueo de stock ya quitado esto ya no impide
-- operar, pero seguía dejando el movimiento anotado en el almacén
-- equivocado — el número correcto para el negocio (recalculado en la Fase
-- 3/4 de este plan) pero en el lugar equivocado.
--
-- Se agrega p_almacen_id uuid DEFAULT null: si no se manda (o es null),
-- se usa el predeterminado — comportamiento idéntico al de siempre para
-- cualquier caller que no lo pase. NUNCA se usa para bloquear ni limitar
-- nada — solo decide en qué almacén queda registrado el movimiento.
--
-- Se elimina el overload viejo de 13 parámetros después de crear este, para
-- no dejar dos versiones de la misma función coexistiendo (mismo riesgo que
-- ya se limpió en migration_fix_venta_valida_stock_disponible.sql).
--
-- CÓMO APLICAR: pegar en Supabase Studio → SQL Editor y ejecutar.
-- =============================================================================

create or replace function public.crear_ticket_pesaje(
  p_tipo text, p_entidad_id uuid, p_fecha date, p_fotos text[], p_observaciones text,
  p_materiales jsonb, p_estado text, p_pesado_por uuid, p_peso_global numeric,
  p_devolucion numeric default 0, p_pesaje_exterior boolean default false,
  p_fotos_devolucion text[] default '{}'::text[], p_pesajes_globales jsonb default '[]'::jsonb,
  p_almacen_id uuid default null
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

-- Elimina el overload viejo (13 parámetros, sin almacén) para que no quede
-- una segunda versión de la misma función sin usar.
drop function if exists public.crear_ticket_pesaje(
  text, uuid, date, text[], text, jsonb, text, uuid, numeric, numeric, boolean, text[], jsonb
);
