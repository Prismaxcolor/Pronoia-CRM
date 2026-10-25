-- =============================================================================
-- MIGRACIÓN: lotes como "producto compuesto" repartible entre almacenes.
--
-- PROBLEMA (pedido de Julio, 14-sep-2026): un lote hoy vive en UN SOLO
-- almacén (lotes.almacen_id, todo-o-nada). No se puede tener, por ejemplo,
-- 500 kg de "Lote 2" en G2 y 500 kg del MISMO Lote 2 en G1 — ni trasladar
-- una porción parcial de un lote sin moverlo completo. Tampoco se puede
-- elegir de qué almacén sale un lote al transformarlo (crear_transformacion_pcb
-- no pedía almacén en absoluto).
--
-- DISEÑO:
--   - La COMPOSICIÓN de un lote (composicion_lote) sigue siendo GLOBAL —
--     no depende de en qué almacén estén los kilos. Partir un lote entre
--     almacenes no reparte porcentajes, solo peso: sigue siendo "el mismo
--     lote" con la misma composición en ambas partes.
--   - Nueva función stock_lote_por_almacen(lote_id) calcula cuántos kg de
--     ESE lote hay en cada almacén, reconstruido igual que stock_almacen()
--     por producto: compras/ventas directas al lote (por el almacén del
--     ticket), traslados (sale del origen al CREARSE, entra al destino al
--     COMPLETARSE, por lo recibido), transformaciones PCB (consume del
--     almacén origen, produce en el almacén que el usuario elija por cada
--     lote de salida), y ajustes de inventario sin desglose por producto.
--   - lotes.almacen_id (columna única, todo-o-nada) se ELIMINA. La
--     ubicación de un lote deja de ser un campo editable a mano y pasa a
--     ser 100% derivada de los movimientos reales — igual que ya pasa con
--     el stock de cualquier producto.
--   - Traslado de lote: ya existe la capacidad de pesar una porción
--     (detalle_traslado.lote_id + peso_bruto/tara, desde la migración v2 de
--     traslados) — lo único que estaba mal es que completar_traslado()
--     igual reasignaba el lote ENTERO al almacén destino
--     (lotes.almacen_id = destino). Eso se elimina: ahora basta con que
--     detalle_traslado.peso_recibido quede registrado, stock_lote_por_almacen
--     ya lo atribuye correctamente sin tocar ninguna columna de "dueño".
--   - Transformación PCB: crear_transformacion_pcb ahora pide
--     p_almacen_id (de dónde sale el lote origen) y lo guarda en
--     transformaciones.almacen_id (columna que YA EXISTÍA, usada hasta
--     ahora solo por la categoría ferroso/no-ferroso). completar_transformacion_pcb
--     ahora pide almacen_id POR CADA lote de salida (el usuario elige a
--     qué almacén va cada lote resultante — pueden ser distintos entre sí
--     y distintos del origen).
--   - Ningún movimiento bloquea por "stock insuficiente en ese almacén"
--     (mismo criterio ya aplicado en migration_remove_bloqueos_stock_insuficiente.sql
--     y migration_remove_bloqueo_transformacion_pcb.sql, 11-sep-2026): la
--     operación siempre se registra, si el cálculo da negativo se refleja
--     así. Se mantiene intacta la conservación de masa DENTRO de una misma
--     transformación/traslado (no recibir más de lo despachado, no sacar
--     más de lo que entró).
--
-- CÓMO APLICAR: pegar en Supabase Studio → SQL Editor y ejecutar, o vía
-- Management API. Orden importa: primero agrega columnas y funciones
-- nuevas, recién al final hace el DROP de lotes.almacen_id (para que nunca
-- haya una ventana donde algo dependa de una columna que ya no existe).
--
-- BACKFILL DE DATOS HISTÓRICOS (ya ejecutado en producción, 14-sep-2026,
-- ANTES del DROP de lotes.almacen_id — no se puede repetir tal cual porque
-- esa columna ya no existe):
--   - transformaciones.almacen_id era NULL en 8 filas PCB creadas antes de
--     este cambio (crear_transformacion_pcb no pedía almacén). Se
--     backfillearon a "ALMACEN G2" porque, verificado con
--     stock_lote_por_almacen() vs stock_lote_total() en cada lote activo,
--     TODO el historial de lotes vivía únicamente en G2 (G1 no tenía
--     ningún movimiento de lote todavía).
--   - transformacion_salida_detalle.almacen_id es una columna NUEVA — se
--     backfilleó igual, a G2, por la misma razón. Verificado que, tras el
--     backfill, sum(stock_lote_por_almacen(l.id)) coincide con
--     stock_lote_total(l.id) para cada lote (con la única diferencia
--     esperada de material en tránsito por un traslado pendiente).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. transformacion_salida_detalle: almacén de destino por cada lote de salida.
-- -----------------------------------------------------------------------------
alter table public.transformacion_salida_detalle
  add column if not exists almacen_id uuid references public.almacenes(id);

-- -----------------------------------------------------------------------------
-- 2. stock_lote_por_almacen(lote_id): cuántos kg de este lote hay en cada
--    almacén, HOY, derivado de todo el historial de movimientos.
-- -----------------------------------------------------------------------------
create or replace function public.stock_lote_por_almacen(p_lote_id uuid)
returns table(almacen_id uuid, stock numeric)
language sql
stable
as $$
  select almacen_id, sum(entrada) - sum(salida) as stock
  from (
    -- compras directas al lote, atribuidas al almacén del ticket de compra
    select tp.almacen_id, coalesce(d.peso_neto, 0) as entrada, 0::numeric as salida
    from public.detalle_tickets_pesaje d
    join public.tickets_pesaje tp on tp.id = d.ticket_id
    where d.destino_tipo = 'lote' and d.lote_id = p_lote_id and tp.tipo = 'compra'
      and tp.almacen_id is not null
    union all
    -- ventas directas del lote, mismo criterio
    select tp.almacen_id, 0::numeric, coalesce(d.peso_neto, 0)
    from public.detalle_tickets_pesaje d
    join public.tickets_pesaje tp on tp.id = d.ticket_id
    where d.destino_tipo = 'lote' and d.lote_id = p_lote_id and tp.tipo = 'venta'
      and tp.almacen_id is not null
    union all
    -- traslados de este lote: descuenta del origen desde que el traslado se
    -- CREA (pendiente o completo) — el material ya salió físicamente, mismo
    -- criterio que el material sin lote en stock_almacen().
    select t.almacen_origen_id, 0::numeric, coalesce(dt.peso_neto, 0)
    from public.detalle_traslado dt
    join public.tickets_traslado t on t.id = dt.traslado_id
    where dt.lote_id = p_lote_id and t.estado in ('pendiente', 'completo')
    union all
    -- entra al destino solo cuando el traslado se COMPLETA (se recibe), y
    -- por lo efectivamente RECIBIDO (no lo despachado) — puede ser una
    -- porción parcial del lote.
    select t.almacen_destino_id, coalesce(dt.peso_recibido, 0), 0::numeric
    from public.detalle_traslado dt
    join public.tickets_traslado t on t.id = dt.traslado_id
    where dt.lote_id = p_lote_id and t.estado = 'completo'
    union all
    -- transformación PCB: consume del almacén origen elegido al crearla
    select tr.almacen_id, 0::numeric, coalesce(tr.peso_neto, 0)
    from public.transformaciones tr
    where tr.lote_origen_id = p_lote_id and tr.categoria = 'pcb'
    union all
    -- transformación PCB: produce en el almacén elegido por cada lote de
    -- salida, solo una vez que la transformación está completa.
    select tsd.almacen_id, coalesce(tsd.peso_neto, 0), 0::numeric
    from public.transformacion_salida_detalle tsd
    join public.transformaciones tr on tr.id = tsd.transformacion_id
    where tsd.lote_destino_id = p_lote_id and tr.estado = 'completa'
    union all
    -- ajustes de inventario sobre el lote — CUALQUIERA (con o sin producto_id
    -- desglosado): un ajuste con producto_id igual mueve kg físicos reales
    -- del almacén, así que cuenta acá también (a diferencia de
    -- stock_lote_por_producto, que sí distingue, esta función solo suma
    -- peso total por almacén).
    select ai.almacen_id, greatest(ai.diferencia, 0), greatest(-ai.diferencia, 0)
    from public.ajustes_inventario ai
    where ai.lote_id = p_lote_id and ai.almacen_id is not null
  ) x
  where almacen_id is not null
  group by almacen_id;
$$;

-- -----------------------------------------------------------------------------
-- 3. crear_traslado: los lotes ya se pesan con peso propio (v2). Se quitan
--    los dos bloqueos que asumían que un lote vive en UN SOLO almacén
--    ("no está activo en el almacén de origen" y "ya tiene un traslado
--    pendiente") — con stock por almacén real, un lote puede tener varias
--    porciones en tránsito o repartidas sin que eso sea un error. Se
--    mantiene la validación de foto obligatoria (regla de evidencia, no de
--    disponibilidad) y el lock de concurrencia sobre el almacén de origen.
-- -----------------------------------------------------------------------------
create or replace function public.crear_traslado(
  p_almacen_origen_id  uuid,
  p_almacen_destino_id uuid,
  p_observaciones      text,
  p_materiales         jsonb,
  p_pesado_por         uuid,
  p_lotes              jsonb DEFAULT '[]'::jsonb,
  p_vehiculo           text DEFAULT NULL::text
) returns uuid
language plpgsql
as $function$
declare
  v_id   uuid;
  v_item jsonb;
begin
  if p_almacen_origen_id = p_almacen_destino_id then
    raise exception 'El almacén de origen y destino no pueden ser el mismo.';
  end if;

  perform 1 from public.almacenes where id = p_almacen_origen_id for update;

  for v_item in select value from jsonb_array_elements(coalesce(p_materiales, '[]'::jsonb)) as elems(value)
  loop
    if public.hay_toma_fisica_abierta(p_almacen_origen_id, (v_item->>'producto_id')::uuid)
       or public.hay_toma_fisica_abierta(p_almacen_destino_id, (v_item->>'producto_id')::uuid) then
      raise exception 'Uno de los materiales tiene una toma física de inventario abierta en el origen o el destino. No se pueden registrar traslados hasta cerrarla.';
    end if;
    if not (v_item ? 'fotos') or jsonb_array_length(v_item->'fotos') = 0 then
      raise exception 'Cada material necesita al menos una foto.';
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_lotes, '[]'::jsonb)) as elems(value)
  loop
    if not exists (select 1 from public.lotes where id = (v_item->>'lote_id')::uuid and activo) then
      raise exception 'Uno de los lotes seleccionados no existe o está archivado.';
    end if;
    if not (v_item ? 'fotos') or jsonb_array_length(v_item->'fotos') = 0 then
      raise exception 'Cada lote necesita al menos una foto del pesaje.';
    end if;
  end loop;

  insert into public.tickets_traslado
    (almacen_origen_id, almacen_destino_id, observaciones, pesado_por, vehiculo)
  values (
    p_almacen_origen_id, p_almacen_destino_id, nullif(p_observaciones, ''), p_pesado_por,
    nullif(p_vehiculo, '')
  )
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_materiales, '[]'::jsonb)) as elems(value)
  loop
    insert into public.detalle_traslado
      (traslado_id, producto_id, subcategoria, peso_bruto, tara, fotos)
    values (
      v_id,
      (v_item->>'producto_id')::uuid,
      nullif(v_item->>'subcategoria', ''),
      (v_item->>'peso_bruto')::numeric,
      (v_item->>'tara')::numeric,
      coalesce((select array_agg(x) from jsonb_array_elements_text(v_item->'fotos') as x), '{}')
    );
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_lotes, '[]'::jsonb)) as elems(value)
  loop
    insert into public.detalle_traslado
      (traslado_id, lote_id, peso_bruto, tara, fotos)
    values (
      v_id,
      (v_item->>'lote_id')::uuid,
      (v_item->>'peso_bruto')::numeric,
      (v_item->>'tara')::numeric,
      coalesce((select array_agg(x) from jsonb_array_elements_text(v_item->'fotos') as x), '{}')
    );
  end loop;

  return v_id;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 4. completar_traslado: deja de reasignar lotes.almacen_id (esa columna
--    desaparece más abajo). El peso_recibido queda registrado en
--    detalle_traslado como siempre — stock_lote_por_almacen() ya lo lee de
--    ahí, sin necesidad de tocar ninguna columna de "dueño" del lote.
-- -----------------------------------------------------------------------------
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

  update public.tickets_traslado
     set estado         = 'completo',
         fotos           = p_fotos,
         completado_por  = p_completado_por,
         completado_en   = now()
   where id = p_traslado_id;

  return p_traslado_id;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 5. crear_transformacion_pcb: agrega p_almacen_id (de qué almacén sale el
--    lote origen). Se guarda en transformaciones.almacen_id (columna ya
--    existente, hasta ahora solo poblada para categoria='ferroso_no_ferroso').
--    No bloquea si ese almacén tiene poco o ningún stock del lote (mismo
--    criterio que migration_remove_bloqueo_transformacion_pcb.sql) — el
--    reparto de composición sigue siendo sobre el TOTAL global del lote
--    (stock_lote_por_producto), porque la composición no depende del
--    almacén, solo el peso.
-- -----------------------------------------------------------------------------
create or replace function public.crear_transformacion_pcb(
  p_lote_origen_id uuid,
  p_peso_bruto     numeric,
  p_tara           numeric,
  p_fecha          date,
  p_notas          text,
  p_fotos_entrada  text[],
  p_registrado_por uuid,
  p_almacen_id     uuid DEFAULT NULL::uuid
) returns uuid
language plpgsql
as $function$
declare
  v_id               uuid;
  v_neto             numeric;
  v_total_disponible numeric;
  v_total_distribuido numeric := 0;
  v_prod             record;
  v_prod_kg          numeric;
  v_null_kg          numeric;
  v_nombre_lote      text;
begin
  select nombre into v_nombre_lote from public.lotes where id = p_lote_origen_id for update;
  if v_nombre_lote is null then
    raise exception 'Lote origen % no encontrado.', p_lote_origen_id;
  end if;

  v_neto := coalesce(p_peso_bruto, 0) - coalesce(p_tara, 0);
  if v_neto <= 0 then
    raise exception 'El peso neto de entrada debe ser mayor a 0.';
  end if;
  if p_fotos_entrada is null or array_length(p_fotos_entrada, 1) is null then
    raise exception 'Agrega al menos una foto de entrada.';
  end if;

  v_total_disponible := public.stock_lote_total(p_lote_origen_id);

  insert into public.transformaciones
    (categoria, lote_origen_id, almacen_id, peso_bruto, tara, fecha, estado, notas, fotos_entrada, registrado_por)
  values
    ('pcb', p_lote_origen_id, p_almacen_id, p_peso_bruto, coalesce(p_tara, 0), coalesce(p_fecha, current_date),
     'bruto', nullif(p_notas, ''), p_fotos_entrada, p_registrado_por)
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
$function$;

-- -----------------------------------------------------------------------------
-- 6. completar_transformacion_pcb: cada lote de salida ahora lleva su
--    propio almacen_id (a dónde va ESE lote resultante) — pueden repartirse
--    a almacenes distintos entre sí y distintos del origen.
-- -----------------------------------------------------------------------------
create or replace function public.completar_transformacion_pcb(p_transformacion_id uuid, p_salidas jsonb, p_completado_por uuid)
returns void
language plpgsql
as $function$
declare
  v_estado            text;
  v_lote_origen_id    uuid;
  v_peso_neto_entrada numeric;
  v_item              jsonb;
  v_suma_salidas      numeric := 0;
  v_peso_bruto        numeric;
  v_tara              numeric;
  v_neto              numeric;
  v_lote_destino      uuid;
  v_almacen_destino   uuid;
  v_fotos             text[];
begin
  select estado, lote_origen_id, peso_neto
    into v_estado, v_lote_origen_id, v_peso_neto_entrada
    from public.transformaciones
   where id = p_transformacion_id and categoria = 'pcb'
     for update;

  if v_estado is null then
    raise exception 'Transformación PCB no encontrada.';
  end if;
  if v_estado <> 'bruto' then
    raise exception 'Esta transformación ya fue completada.';
  end if;

  if p_salidas is null or jsonb_typeof(p_salidas) <> 'array' or jsonb_array_length(p_salidas) = 0 then
    raise exception 'Agrega al menos un lote de destino.';
  end if;

  for v_item in select value from jsonb_array_elements(p_salidas) as elems(value)
  loop
    v_lote_destino := (v_item->>'lote_destino_id')::uuid;
    v_peso_bruto := (v_item->>'peso_bruto')::numeric;
    v_tara := coalesce((v_item->>'tara')::numeric, 0);
    v_neto := v_peso_bruto - v_tara;
    v_almacen_destino := nullif(v_item->>'almacen_id', '')::uuid;

    if v_lote_destino = v_lote_origen_id then
      raise exception 'El lote destino debe ser distinto del lote origen.';
    end if;
    if v_neto <= 0 then
      raise exception 'El peso neto de cada salida debe ser mayor a 0.';
    end if;
    if not exists (select 1 from public.lotes where id = v_lote_destino and activo) then
      raise exception 'Lote destino % no encontrado o archivado.', v_lote_destino;
    end if;
    if v_almacen_destino is not null and not exists (select 1 from public.almacenes where id = v_almacen_destino and activo) then
      raise exception 'Almacén destino % no encontrado o inactivo.', v_almacen_destino;
    end if;

    v_suma_salidas := v_suma_salidas + v_neto;
  end loop;

  if v_suma_salidas > v_peso_neto_entrada + 0.01 then
    raise exception 'La suma de las salidas (%) supera el peso neto de entrada (%).',
      round(v_suma_salidas, 2), round(v_peso_neto_entrada, 2);
  end if;

  for v_item in select value from jsonb_array_elements(p_salidas) as elems(value)
  loop
    v_fotos := coalesce(array(select jsonb_array_elements_text(v_item->'fotos')), '{}');
    insert into public.transformacion_salida_detalle (transformacion_id, lote_destino_id, almacen_id, peso_bruto, tara, fotos)
    values (
      p_transformacion_id,
      (v_item->>'lote_destino_id')::uuid,
      nullif(v_item->>'almacen_id', '')::uuid,
      (v_item->>'peso_bruto')::numeric,
      coalesce((v_item->>'tara')::numeric, 0),
      v_fotos
    );
  end loop;

  update public.transformaciones
     set estado = 'completa', completado_por = p_completado_por, completado_en = now()
   where id = p_transformacion_id;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 7. stock_almacen: el bloque con_lote deja de usar lotes.almacen_id
--    (todo-o-nada) y reparte usando stock_lote_por_almacen(), multiplicando
--    la composición por producto (stock_lote_por_producto) por la
--    PROPORCIÓN de ese lote que vive en este almacén — así el desglose por
--    producto de stock_almacen() sigue sumando el total real del lote.
-- -----------------------------------------------------------------------------
create or replace function public.stock_almacen(p_almacen_id uuid)
returns table(producto_id uuid, stock numeric)
language sql
stable
as $$
  with sin_lote as (
    select producto_id, sum(entrada) - sum(salida) as stock from (
      select dt.producto_id, coalesce(dt.peso_recibido, 0) as entrada, 0::numeric as salida
      from public.detalle_traslado dt join public.tickets_traslado t on t.id = dt.traslado_id
      where t.almacen_destino_id = p_almacen_id and t.estado = 'completo'
      union all
      select dt.producto_id, 0::numeric, coalesce(dt.peso_neto, 0)
      from public.detalle_traslado dt join public.tickets_traslado t on t.id = dt.traslado_id
      where t.almacen_origen_id = p_almacen_id and t.estado in ('pendiente', 'completo')
      union all
      select d.producto_id, coalesce(d.peso_neto, 0), 0::numeric
      from public.detalle_tickets_pesaje d join public.tickets_pesaje tp on tp.id = d.ticket_id
      where tp.almacen_id = p_almacen_id and tp.tipo = 'compra'
        and coalesce(nullif(d.destino_tipo, ''), 'mpp') <> 'lote'
      union all
      select d.producto_id, 0::numeric, coalesce(d.peso_neto, 0)
      from public.detalle_tickets_pesaje d join public.tickets_pesaje tp on tp.id = d.ticket_id
      where tp.almacen_id = p_almacen_id and tp.tipo = 'venta'
        and coalesce(nullif(d.destino_tipo, ''), 'mpp') <> 'lote'
      union all
      select producto_id, greatest(diferencia, 0), greatest(-diferencia, 0)
      from public.ajustes_inventario
      where almacen_id = p_almacen_id and lote_id is null
      union all
      select ted.producto_id, 0::numeric, coalesce(ted.peso_kg, 0)
      from public.transformacion_entrada_detalle ted
      join public.transformaciones t on t.id = ted.transformacion_id
      where t.almacen_id = p_almacen_id and t.categoria = 'ferroso_no_ferroso'
      union all
      select tsd.producto_id, coalesce(tsd.peso_neto, 0), 0::numeric
      from public.transformacion_salida_detalle tsd
      join public.transformaciones t on t.id = tsd.transformacion_id
      where t.almacen_id = p_almacen_id and t.categoria = 'ferroso_no_ferroso' and t.estado = 'completa'
    ) x where producto_id is not null group by producto_id
  ),
  con_lote as (
    -- para cada lote con presencia en este almacén, reparte su composición
    -- por producto (global) proporcional a la fracción del lote que vive
    -- aquí (kg_en_este_almacen / kg_totales_del_lote).
    select slp.producto_id, sum(slp.stock * frac.frac_almacen) as stock
    from (
      select l.id as lote_id,
             la.stock / nullif(public.stock_lote_total(l.id), 0) as frac_almacen
      from public.lotes l
      join public.stock_lote_por_almacen(l.id) la on la.almacen_id = p_almacen_id
    ) frac
    join public.stock_lote_por_producto(frac.lote_id) slp on true
    where frac.frac_almacen is not null
    group by slp.producto_id
  )
  select producto_id, sum(stock) as stock
  from (
    select * from sin_lote
    union all
    select * from con_lote
  ) z
  group by producto_id;
$$;

-- -----------------------------------------------------------------------------
-- 8. lotes.almacen_id deja de existir — la ubicación es 100% derivada.
--    Último paso, después de que todas las funciones de arriba ya no la
--    usan (marcar_almacen_predeterminado y demás RPCs no la tocan).
-- -----------------------------------------------------------------------------
alter table public.lotes drop column if exists almacen_id;
