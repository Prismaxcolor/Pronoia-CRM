-- =============================================================================
-- MIGRACIÓN: la COMPOSICIÓN de un lote es por (lote, almacén), no global.
--
-- CORRECCIÓN sobre migration_lote_stock_por_almacen.sql (14-sep-2026, mismo
-- día): esa primera migración ya resolvía el PESO por almacén
-- correctamente (stock_lote_por_almacen), pero seguía usando
-- composicion_lote()/stock_lote_por_producto() —GLOBALES, mezclan todos los
-- almacenes— para calcular transformaciones, traslados y tomas físicas.
--
-- EJEMPLO que expuso el problema (Julio, 14-sep-2026): si entran 500 kg de
-- "Mixto 1" al Lote 2 QUE ESTÁ EN G2, eso debe subir la composición de
-- Mixto 1 en el Lote 2 **de G2** a, digamos, 90% — pero el Lote 2 que está
-- en G1 (si lo hay) debe quedar EXACTAMENTE IGUAL. La composición global
-- (todo mezclado) no sirve para decidir qué sale cuando alguien transforma
-- el Lote 2 desde G2, ni para comparar contra una toma física de un solo
-- almacén.
--
-- DISEÑO:
--   - Nuevas funciones ESCOPADAS por (lote_id, almacen_id):
--     stock_lote_almacen_por_producto, stock_lote_almacen_total,
--     composicion_lote_almacen. Reemplazan a las globales
--     (stock_lote_por_producto/stock_lote_total/composicion_lote) en TODO
--     cálculo operativo: transformación PCB, traslado, toma física.
--   - Las funciones globales (composicion_lote, stock_lote_por_producto,
--     stock_lote_total) NO se tocan — siguen sirviendo como vista
--     consolidada "todo el lote junto" para reportes, y sirven de base a
--     stock_lote_por_almacen (que solo calcula PESO, no composición, y ya
--     estaba correcto).
--   - Traslado de una porción de lote: ahora toma un SNAPSHOT de la
--     composición del almacén de ORIGEN en el momento de crear el
--     traslado (nueva tabla detalle_traslado_composicion, mismo patrón que
--     transformacion_entrada_detalle — no se recalcula después porque la
--     composición del origen sigue cambiando con el tiempo). Al recibirse,
--     ese snapshot se escala a lo efectivamente recibido (puede diferir de
--     lo despachado) y se suma a la composición del almacén DESTINO.
--   - crear_transformacion_pcb: la entrada ya no reparte contra la
--     composición global del lote, sino contra la del almacén elegido
--     (p_almacen_id, que ya existía desde la migración anterior).
--   - resumen_toma_fisica / culminar_toma_fisica_inventario: el "teórico"
--     de un lote dentro de una toma física ahora es el stock de ESE lote
--     EN el almacén de la toma física, no el total global — y los ajustes
--     que genera se reparten contra la composición de ESE almacén.
--   - stock_almacen(): el bloque con_lote se simplifica — en vez de
--     "composición global × fracción de peso en este almacén" (aproximado
--     y potencialmente engañoso), suma directo
--     stock_lote_almacen_por_producto(lote, este_almacén).
--
-- CÓMO APLICAR: pegar en Supabase Studio → SQL Editor y ejecutar, o vía
-- Management API.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Snapshot de composición de la porción de lote que viaja en un traslado.
-- -----------------------------------------------------------------------------
create table if not exists public.detalle_traslado_composicion (
  id                   uuid primary key default gen_random_uuid(),
  detalle_traslado_id  uuid not null references public.detalle_traslado(id) on delete cascade,
  producto_id          uuid references public.productos(id),
  peso_kg              numeric not null check (peso_kg > 0)
);
alter table public.detalle_traslado_composicion disable row level security;
create index if not exists idx_dtc_detalle on public.detalle_traslado_composicion (detalle_traslado_id);

-- -----------------------------------------------------------------------------
-- 2. stock_lote_almacen_por_producto: composición real de un lote, EN UN
--    almacén específico.
-- -----------------------------------------------------------------------------
create or replace function public.stock_lote_almacen_por_producto(p_lote_id uuid, p_almacen_id uuid)
returns table(producto_id uuid, stock numeric)
language sql
stable
as $$
  with transformacion_totales as (
    select transformacion_id, sum(peso_kg) as total_entrada
    from public.transformacion_entrada_detalle
    group by transformacion_id
  ),
  salida_distribuida as (
    select tsd.lote_destino_id as lote_id, tsd.almacen_id,
           ted.producto_id,
           tsd.peso_neto * ted.peso_kg / tt.total_entrada as monto
    from public.transformacion_salida_detalle tsd
    join transformacion_totales tt on tt.transformacion_id = tsd.transformacion_id
    join public.transformacion_entrada_detalle ted on ted.transformacion_id = tsd.transformacion_id
    where tsd.lote_destino_id is not null and tt.total_entrada > 0
  )
  select producto_id, sum(entrada) - sum(salida) as stock
  from (
    -- compras directas al lote, en ESTE almacén
    select d.producto_id, coalesce(d.peso_neto, 0) as entrada, 0::numeric as salida
    from public.detalle_tickets_pesaje d
    join public.tickets_pesaje tp on tp.id = d.ticket_id
    where d.destino_tipo = 'lote' and d.lote_id = p_lote_id and tp.tipo = 'compra' and tp.almacen_id = p_almacen_id
    union all
    -- ventas directas del lote, en ESTE almacén
    select d.producto_id, 0::numeric, coalesce(d.peso_neto, 0)
    from public.detalle_tickets_pesaje d
    join public.tickets_pesaje tp on tp.id = d.ticket_id
    where d.destino_tipo = 'lote' and d.lote_id = p_lote_id and tp.tipo = 'venta' and tp.almacen_id = p_almacen_id
    union all
    -- transformación PCB que consumió este lote DESDE este almacén
    select ted.producto_id, 0::numeric, coalesce(ted.peso_kg, 0)
    from public.transformacion_entrada_detalle ted
    join public.transformaciones t on t.id = ted.transformacion_id
    where t.lote_origen_id = p_lote_id and t.almacen_id = p_almacen_id
    union all
    -- ajustes de toma física / manuales, en ESTE almacén, con producto
    select ai.producto_id,
           case when ai.diferencia > 0 then ai.diferencia else 0 end,
           case when ai.diferencia < 0 then -ai.diferencia else 0 end
    from public.ajustes_inventario ai
    where ai.lote_id = p_lote_id and ai.almacen_id = p_almacen_id and ai.producto_id is not null
    union all
    -- recibido de una transformación cuya salida quedó asignada a ESTE almacén
    select producto_id, monto, 0::numeric
    from salida_distribuida
    where lote_id = p_lote_id and almacen_id = p_almacen_id and producto_id is not null
    union all
    -- traslado RECIBIDO: composición que llegó, escalada a lo efectivamente
    -- recibido (puede diferir de lo despachado por discrepancia de pesaje).
    select dtc.producto_id, dtc.peso_kg * (dt.peso_recibido / nullif(dt.peso_neto, 0)), 0::numeric
    from public.detalle_traslado_composicion dtc
    join public.detalle_traslado dt on dt.id = dtc.detalle_traslado_id
    join public.tickets_traslado t on t.id = dt.traslado_id
    where dt.lote_id = p_lote_id and t.almacen_destino_id = p_almacen_id and t.estado = 'completo'
      and dtc.producto_id is not null
    union all
    -- traslado ENVIADO: composición que salió (snapshot al pesar) — se
    -- descuenta desde que el traslado se CREA, igual que el peso total.
    select dtc.producto_id, 0::numeric, dtc.peso_kg
    from public.detalle_traslado_composicion dtc
    join public.detalle_traslado dt on dt.id = dtc.detalle_traslado_id
    join public.tickets_traslado t on t.id = dt.traslado_id
    where dt.lote_id = p_lote_id and t.almacen_origen_id = p_almacen_id and t.estado in ('pendiente', 'completo')
      and dtc.producto_id is not null
  ) x
  where producto_id is not null
  group by producto_id;
$$;

-- -----------------------------------------------------------------------------
-- 3. stock_lote_almacen_total: envuelve stock_lote_por_almacen() (peso ya
--    verificado) en vez de reimplementar el ledger.
-- -----------------------------------------------------------------------------
create or replace function public.stock_lote_almacen_total(p_lote_id uuid, p_almacen_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(
    (select stock from public.stock_lote_por_almacen(p_lote_id) where almacen_id = p_almacen_id),
    0
  );
$$;

-- -----------------------------------------------------------------------------
-- 4. composicion_lote_almacen: composición real de un lote EN un almacén
--    específico — la que hay que usar para transformar o comparar contra
--    una toma física de ESE almacén. Mismo criterio que composicion_lote()
--    (global): porcentaje contra la suma de lo conocido, no contra el total
--    (que puede incluir un remanente sin clasificar).
-- -----------------------------------------------------------------------------
create or replace function public.composicion_lote_almacen(p_lote_id uuid, p_almacen_id uuid)
returns table(producto_id uuid, producto_nombre text, stock numeric, porcentaje numeric)
language sql
stable
as $$
  with base as (
    select slp.producto_id, p.nombre as producto_nombre, slp.stock
    from public.stock_lote_almacen_por_producto(p_lote_id, p_almacen_id) slp
    join public.productos p on p.id = slp.producto_id
    where slp.stock > 0
  ),
  total as (select coalesce(sum(stock), 0) as t from base)
  select b.producto_id, b.producto_nombre, b.stock,
    case when t.t > 0 then round(b.stock / t.t * 100, 2) else 0 end as porcentaje
  from base b cross join total t
  order by b.stock desc;
$$;

-- -----------------------------------------------------------------------------
-- 5. crear_traslado: cada línea de lote ahora también guarda el snapshot de
--    composición del almacén de origen (detalle_traslado_composicion),
--    repartido igual que crear_transformacion_pcb reparte una entrada.
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
  v_id            uuid;
  v_item          jsonb;
  v_detalle_id    uuid;
  v_lote_id       uuid;
  v_neto_lote     numeric;
  v_total_disp    numeric;
  v_distribuido   numeric;
  v_resto         numeric;
  v_comp          record;
  v_kg            numeric;
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
    v_lote_id := (v_item->>'lote_id')::uuid;
    v_neto_lote := (v_item->>'peso_bruto')::numeric - (v_item->>'tara')::numeric;

    insert into public.detalle_traslado (traslado_id, lote_id, peso_bruto, tara, fotos)
    values (
      v_id, v_lote_id, (v_item->>'peso_bruto')::numeric, (v_item->>'tara')::numeric,
      coalesce((select array_agg(x) from jsonb_array_elements_text(v_item->'fotos') as x), '{}')
    )
    returning id into v_detalle_id;

    -- Snapshot de composición: reparte el neto trasladado proporcional a lo
    -- que HOY compone ese lote en el almacén de origen (no se puede
    -- recalcular después — la composición del origen sigue cambiando).
    v_total_disp := public.stock_lote_almacen_total(v_lote_id, p_almacen_origen_id);
    v_distribuido := 0;
    if v_total_disp > 0 and v_neto_lote > 0 then
      for v_comp in
        select producto_id, stock from public.stock_lote_almacen_por_producto(v_lote_id, p_almacen_origen_id) where stock > 0
      loop
        v_kg := round(v_neto_lote * v_comp.stock / v_total_disp, 4);
        if v_kg > 0 then
          insert into public.detalle_traslado_composicion (detalle_traslado_id, producto_id, peso_kg)
          values (v_detalle_id, v_comp.producto_id, v_kg);
          v_distribuido := v_distribuido + v_kg;
        end if;
      end loop;
    end if;
    v_resto := round(v_neto_lote - v_distribuido, 4);
    if v_resto > 0 then
      insert into public.detalle_traslado_composicion (detalle_traslado_id, producto_id, peso_kg)
      values (v_detalle_id, null, v_resto);
    end if;
  end loop;

  return v_id;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 6. crear_transformacion_pcb: la entrada se reparte contra la composición
--    del almacén elegido, no contra la composición global del lote.
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
  v_id                 uuid;
  v_neto               numeric;
  v_total_disponible   numeric;
  v_total_distribuido  numeric := 0;
  v_prod               record;
  v_prod_kg            numeric;
  v_null_kg            numeric;
  v_nombre_lote        text;
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

  v_total_disponible := public.stock_lote_almacen_total(p_lote_origen_id, p_almacen_id);

  insert into public.transformaciones
    (categoria, lote_origen_id, almacen_id, peso_bruto, tara, fecha, estado, notas, fotos_entrada, registrado_por)
  values
    ('pcb', p_lote_origen_id, p_almacen_id, p_peso_bruto, coalesce(p_tara, 0), coalesce(p_fecha, current_date),
     'bruto', nullif(p_notas, ''), p_fotos_entrada, p_registrado_por)
  returning id into v_id;

  if v_total_disponible > 0 then
    for v_prod in
      select producto_id, stock from public.stock_lote_almacen_por_producto(p_lote_origen_id, p_almacen_id) where stock > 0
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
-- 7. resumen_toma_fisica: el "teórico" de un lote es su stock EN el almacén
--    de la toma física, no el total global del lote.
-- -----------------------------------------------------------------------------
create or replace function public.resumen_toma_fisica(p_toma_fisica_id uuid)
returns table(producto_id uuid, producto_nombre text, lote_id uuid, lote_nombre text, stock_teorico numeric, stock_real numeric, diferencia numeric, cantidad_pesajes integer)
language plpgsql
as $function$
declare
  v_almacen_id uuid;
  v_categorias uuid[];
begin
  select almacen_id, categorias into v_almacen_id, v_categorias
    from public.tomas_fisicas_inventario where id = p_toma_fisica_id;

  if v_almacen_id is null then
    raise exception 'Toma física no encontrada.';
  end if;

  return query
  with contado_producto as (
    select d.producto_id, sum(d.peso_neto) as real_kg, count(*)::int as pesajes
    from public.detalle_toma_fisica d
    where d.toma_fisica_id = p_toma_fisica_id and d.producto_id is not null
    group by d.producto_id
  ),
  contado_lote as (
    select d.lote_id, sum(d.peso_neto) as real_kg, count(*)::int as pesajes
    from public.detalle_toma_fisica d
    where d.toma_fisica_id = p_toma_fisica_id and d.producto_id is null
    group by d.lote_id
  ),
  sin_lote_universo as (
    select p.id as producto_id, p.nombre as producto_nombre, null::uuid as lote_id, null::text as lote_nombre,
           coalesce(sg.stock, 0) as teorico
    from public.productos p
    join public.tipos_material tm on tm.id = p.tipo_material_id and tm.sin_lote = true
    left join public.stock_almacen(v_almacen_id) sg on sg.producto_id = p.id
    where p.activo = true and p.tipo_material_id = any(v_categorias)
  ),
  con_lote_universo as (
    select null::uuid as producto_id, null::text as producto_nombre, cl.lote_id, l.nombre as lote_nombre,
           public.stock_lote_almacen_total(cl.lote_id, v_almacen_id) as teorico
    from contado_lote cl
    join public.lotes l on l.id = cl.lote_id
  ),
  universo as (
    select * from sin_lote_universo
    union all
    select * from con_lote_universo
  )
  select
    u.producto_id, u.producto_nombre, u.lote_id, u.lote_nombre,
    u.teorico,
    coalesce(cp.real_kg, cl.real_kg, 0),
    coalesce(cp.real_kg, cl.real_kg, 0) - u.teorico,
    coalesce(cp.pesajes, cl.pesajes, 0)
  from universo u
  left join contado_producto cp on u.producto_id is not null and cp.producto_id = u.producto_id
  left join contado_lote cl on u.lote_id is not null and u.producto_id is null and cl.lote_id = u.lote_id
  order by u.producto_nombre nulls last, u.lote_nombre nulls last;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 8. culminar_toma_fisica_inventario: el ajuste por lote se reparte contra
--    la composición del almacén de la toma física, no la global.
-- -----------------------------------------------------------------------------
create or replace function public.culminar_toma_fisica_inventario(p_toma_fisica_id uuid, p_cerrada_por uuid)
returns void
language plpgsql
as $function$
declare
  v_estado      text;
  v_almacen_id  uuid;
  v_fila        record;
  v_comp        record;
  v_total_comp  numeric;
  v_null_actual numeric;
  v_factor      numeric;
  v_snapshot    jsonb;
begin
  select estado, almacen_id into v_estado, v_almacen_id
    from public.tomas_fisicas_inventario where id = p_toma_fisica_id
    for update;

  if v_estado is null then
    raise exception 'Toma física no encontrada.';
  end if;
  if v_estado <> 'abierta' then
    raise exception 'Esta toma física ya está cerrada.';
  end if;

  perform 1 from public.almacenes where id = v_almacen_id for update;

  select json_agg(row_to_json(r)) into v_snapshot
    from public.resumen_toma_fisica(p_toma_fisica_id) r;

  for v_fila in select * from public.resumen_toma_fisica(p_toma_fisica_id)
  loop
    continue when v_fila.diferencia = 0;

    if v_fila.producto_id is not null then
      insert into public.ajustes_inventario
        (toma_fisica_id, producto_id, lote_id, almacen_id, stock_teorico, stock_real, registrado_por)
      values
        (p_toma_fisica_id, v_fila.producto_id, null, v_almacen_id, v_fila.stock_teorico, v_fila.stock_real, p_cerrada_por);
    else
      perform 1 from public.lotes where id = v_fila.lote_id for update;

      if v_fila.stock_teorico > 0.01 then
        v_factor := (v_fila.stock_teorico + v_fila.diferencia) / v_fila.stock_teorico;

        -- IMPORTANTE: se calcula ANTES de insertar cualquier ajuste nuevo —
        -- stock_lote_almacen_por_producto() lee ajustes_inventario en vivo.
        select coalesce(sum(stock), 0) into v_total_comp
          from public.stock_lote_almacen_por_producto(v_fila.lote_id, v_almacen_id);
        v_null_actual := v_fila.stock_teorico - v_total_comp;

        for v_comp in select * from public.stock_lote_almacen_por_producto(v_fila.lote_id, v_almacen_id)
        loop
          if abs(v_comp.stock) > 0.0001 then
            insert into public.ajustes_inventario
              (toma_fisica_id, producto_id, lote_id, almacen_id, stock_teorico, stock_real, registrado_por)
            values (
              p_toma_fisica_id, v_comp.producto_id, v_fila.lote_id, v_almacen_id,
              v_comp.stock, v_comp.stock * v_factor, p_cerrada_por
            );
          end if;
        end loop;

        if abs(v_null_actual) > 0.01 then
          insert into public.ajustes_inventario
            (toma_fisica_id, producto_id, lote_id, almacen_id, stock_teorico, stock_real, registrado_por)
          values (
            p_toma_fisica_id, null, v_fila.lote_id, v_almacen_id,
            v_null_actual, v_null_actual * v_factor, p_cerrada_por
          );
        end if;
      else
        insert into public.ajustes_inventario
          (toma_fisica_id, producto_id, lote_id, almacen_id, stock_teorico, stock_real, registrado_por)
        values (p_toma_fisica_id, null, v_fila.lote_id, v_almacen_id, v_fila.stock_teorico, v_fila.stock_real, p_cerrada_por);
      end if;
    end if;
  end loop;

  update public.tomas_fisicas_inventario
     set estado = 'cerrada',
         cerrada_por = p_cerrada_por,
         cerrada_en = now(),
         snapshot_resumen = v_snapshot
   where id = p_toma_fisica_id;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 9. stock_almacen(): con_lote suma directo la composición escopada por
--    almacén, en vez de aproximar con "composición global × fracción de peso".
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
    select slp.producto_id, sum(slp.stock) as stock
    from public.lotes l
    cross join lateral public.stock_lote_almacen_por_producto(l.id, p_almacen_id) slp
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
