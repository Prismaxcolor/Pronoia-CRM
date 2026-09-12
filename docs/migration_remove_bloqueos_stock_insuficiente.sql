-- =============================================================================
-- MIGRACIÓN: elimina los bloqueos por "stock insuficiente" en ventas,
--            traslados y transformaciones (PCB y ferroso/no-ferroso).
--
-- MOTIVO (decisión explícita de Julio, 11-sep-2026): las validaciones
-- agregadas el 10-sep (ver migration_fix_venta_valida_stock_disponible.sql
-- y migration_fix_transformaciones_traslados_stock.sql) impedían operar
-- cuando el sistema calculaba que un lote/almacén no tenía suficiente
-- material — pero como hay más de una fuente de cálculo y más de un
-- almacén, el bloqueo terminaba disparando por desajustes de contabilidad
-- interna (ej. ALUMINIO DURO: 500 kg reales en ALMACEN G1, pero la venta
-- siempre valida contra ALMACEN G2 porque las ventas están fijas al
-- "almacén predeterminado" y nunca dejan elegir almacén — el bloqueo
-- disparó con "0.00 kg disponibles" sobre un material que sí existe).
--
-- Julio pidió explícitamente que ningún movimiento (venta, traslado,
-- transformación) bloquee por falta de stock — que la operación se
-- registre siempre, y si el resultado da stock negativo, que se refleje
-- así (negativo) en vez de impedir la operación. Bloquear en un sistema
-- que todavía no tiene una única fuente de verdad solo esconde el
-- problema real (que hay que resolver en el motor de cálculo, no en la
-- puerta de entrada).
--
-- Se mantiene SIN TOCAR la validación de "salidas > entrada" dentro de
-- una misma transformación (completar_transformacion_ferroso y el
-- equivalente legacy) — esa NO es una validación de stock disponible,
-- es una regla de conservación de masa dentro de UNA sola transformación
-- (no se puede sacar más kg de los que se metieron en esa transformación
-- puntual). Quitarla permitiría inventar material de la nada, que es el
-- problema contrario al que se está resolviendo aquí.
--
-- Tampoco se toca el bloqueo de "toma física abierta" (crear/completar/
-- editar_ticket_pesaje, crear_traslado) — es un lock de flujo de trabajo,
-- no una validación de cantidad disponible.
--
-- CÓMO APLICAR: pegar en Supabase Studio → SQL Editor y ejecutar.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- validar_stock_venta: ya no bloquea. Queda como no-op a propósito (en vez
-- de borrarla) porque crear/completar/editar_ticket_pesaje ya la llaman —
-- así no hay que tocar esas 3 funciones también.
-- ---------------------------------------------------------------------------
create or replace function public.validar_stock_venta(p_tipo text, p_materiales jsonb, p_almacen_id uuid)
returns void
language plpgsql
as $$
begin
  return;
end;
$$;

-- ---------------------------------------------------------------------------
-- crear_transformacion (legacy, retira de lote-pool): ya no bloquea por
-- stock insuficiente. Si el lote ya está en 0 o negativo, todo el peso
-- retirado se registra como "sin clasificar" (mismo tratamiento que ya
-- existe para un lote sin composición conocida) en vez de dividir por un
-- total disponible que podría ser 0 o negativo.
-- ---------------------------------------------------------------------------
create or replace function public.crear_transformacion(p_lote_origen_id uuid, p_peso_bruto numeric, p_tara numeric, p_fecha date, p_notas text, p_registrado_por uuid)
returns uuid
language plpgsql
as $$
declare
  v_id                 uuid;
  v_neto               numeric;
  v_total_disponible   numeric;
  v_total_distribuido  numeric := 0;
  v_prod                record;
  v_prod_kg             numeric;
  v_null_kg              numeric;
  v_nombre_lote         text;
begin
  select nombre into v_nombre_lote from public.lotes where id = p_lote_origen_id for update;
  if v_nombre_lote is null then
    raise exception 'Lote origen % no encontrado.', p_lote_origen_id;
  end if;

  v_neto := coalesce(p_peso_bruto, 0) - coalesce(p_tara, 0);
  if v_neto <= 0 then
    raise exception 'El peso neto debe ser mayor a 0.';
  end if;

  v_total_disponible := public.stock_lote_total(p_lote_origen_id);

  insert into public.transformaciones
    (lote_origen_id, peso_bruto, tara, fecha, estado, notas, registrado_por)
  values
    (p_lote_origen_id, p_peso_bruto, coalesce(p_tara, 0), coalesce(p_fecha, current_date),
     'bruto', nullif(p_notas, ''), p_registrado_por)
  returning id into v_id;

  if v_total_disponible > 0 then
    for v_prod in
      select producto_id, stock from public.stock_lote_por_producto(p_lote_origen_id) where stock > 0
    loop
      v_prod_kg := round(v_neto * v_prod.stock / v_total_disponible, 4);
      if v_prod_kg > 0 then
        insert into public.transformacion_entrada_detalle (transformacion_id, producto_id, peso_kg)
        values (v_id, v_prod.producto_id, v_prod_kg);
        v_total_distribuido := v_total_distribuido + v_prod_kg;
      end if;
    end loop;
  end if;

  v_null_kg := round(v_neto - v_total_distribuido, 4);
  if v_null_kg > 0 then
    insert into public.transformacion_entrada_detalle (transformacion_id, producto_id, peso_kg)
    values (v_id, null, v_null_kg);
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- crear_transformacion_ferroso: ya no bloquea por stock insuficiente en el
-- almacén de origen.
-- ---------------------------------------------------------------------------
create or replace function public.crear_transformacion_ferroso(p_producto_entrada_id uuid, p_almacen_id uuid, p_peso_bruto numeric, p_tara numeric, p_fecha date, p_notas text, p_fotos_entrada text[], p_registrado_por uuid)
returns uuid
language plpgsql
as $$
declare
  v_peso_neto numeric;
  v_id uuid;
begin
  v_peso_neto := p_peso_bruto - p_tara;
  if v_peso_neto <= 0 then
    raise exception 'El peso neto de entrada debe ser mayor a 0.';
  end if;
  if p_fotos_entrada is null or array_length(p_fotos_entrada, 1) is null then
    raise exception 'Agrega al menos una foto de entrada.';
  end if;

  insert into transformaciones (
    categoria, producto_entrada_id, almacen_id, lote_origen_id, peso_bruto, tara, fecha, estado, notas, fotos_entrada, registrado_por
  ) values (
    'ferroso_no_ferroso', p_producto_entrada_id, p_almacen_id, null, p_peso_bruto, p_tara, p_fecha, 'bruto', p_notas, p_fotos_entrada, p_registrado_por
  ) returning id into v_id;

  insert into transformacion_entrada_detalle (transformacion_id, producto_id, peso_kg)
  values (v_id, p_producto_entrada_id, v_peso_neto);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- crear_traslado: ya no bloquea por stock insuficiente en el almacén de
-- origen. Mantiene el lock FOR UPDATE (concurrencia) y el bloqueo de toma
-- física abierta, que no son validaciones de cantidad disponible.
-- ---------------------------------------------------------------------------
create or replace function public.crear_traslado(p_almacen_origen_id uuid, p_almacen_destino_id uuid, p_observaciones text, p_materiales jsonb, p_pesado_por uuid)
returns uuid
language plpgsql
as $$
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
$$;
