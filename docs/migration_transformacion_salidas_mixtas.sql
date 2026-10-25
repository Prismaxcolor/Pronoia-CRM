-- =============================================================================
-- Salidas mixtas en transformaciones.
--
-- Hoy ferroso solo saca materiales (producto) y PCB solo saca lotes. Esta
-- migración permite en ambas categorías:
--   PCB (entrada lote)       -> lotes Y materiales sueltos (basura, aluminio)
--   FERROSO (entrada material) -> materiales Y un material que va a un LOTE
-- Filas en transformacion_salida_detalle:
--   A) material suelto:    producto_id sí, lote_destino_id NULL
--   B) lote heredado:      producto_id NULL, lote_destino_id sí (como hoy en PCB)
--   C) lote con producto:  producto_id sí y lote_destino_id sí (NUEVO)
--
-- Contenido (todo CREATE OR REPLACE / aditivo, sin cambios de esquema):
--   1. Función nueva completar_transformacion_mixta (las RPC
--      completar_transformacion_ferroso / _pcb NO se tocan).
--   2. stock_almacen: la rama sin_lote cuenta salidas con producto y sin lote
--      de cualquier categoría, en coalesce(tsd.almacen_id, t.almacen_id).
--      Para los datos existentes el resultado es idéntico.
--   3. stock_lote_por_producto / stock_lote_almacen_por_producto: la salida
--      distribuida solo aplica a filas sin producto (tipo B); nueva rama directa
--      para tipo C.
--   4. stock_lote_total: salida_null_distribuida solo para producto_id NULL.
--   stock_lote_por_almacen, stock_global y composicion_lote* no cambian.
--
-- Basada en las definiciones VIVAS de producción (pg_get_functiondef,
-- 2026-09-30), no en docs/sql/functions (desactualizado).
-- Copia de las definiciones originales:
--   C:/dev/OCH8-migracion/clients/PRONOIA/backups/2026-09-30-pre-salidas-mixtas/funciones_stock_antes.json
--
-- ROLLBACK (manual; antes de revertir, verificar que no existan filas tipo C
-- ni PCB con material suelto, porque las definiciones previas no las
-- entienden). Ejecutar:
--   drop function if exists public.completar_transformacion_mixta(uuid, jsonb, uuid);
-- y restaurar las definiciones previas:
-- stock_almacen
--   CREATE OR REPLACE FUNCTION public.stock_almacen(p_almacen_id uuid)
--    RETURNS TABLE(producto_id uuid, stock numeric)
--    LANGUAGE sql
--    STABLE
--   AS $function$
--     with sin_lote as (
--       select producto_id, sum(entrada) - sum(salida) as stock from (
--         select dt.producto_id, coalesce(dt.peso_recibido, 0) as entrada, 0::numeric as salida
--         from public.detalle_traslado dt join public.tickets_traslado t on t.id = dt.traslado_id
--         where t.almacen_destino_id = p_almacen_id and t.estado = 'completo'
--         union all
--         select dt.producto_id, 0::numeric, coalesce(dt.peso_neto, 0)
--         from public.detalle_traslado dt join public.tickets_traslado t on t.id = dt.traslado_id
--         where t.almacen_origen_id = p_almacen_id and t.estado in ('pendiente', 'completo')
--         union all
--         select d.producto_id, coalesce(d.peso_neto, 0), 0::numeric
--         from public.detalle_tickets_pesaje d join public.tickets_pesaje tp on tp.id = d.ticket_id
--         where tp.almacen_id = p_almacen_id and tp.tipo = 'compra'
--           and coalesce(nullif(d.destino_tipo, ''), 'mpp') <> 'lote'
--         union all
--         select d.producto_id, 0::numeric, coalesce(d.peso_neto, 0)
--         from public.detalle_tickets_pesaje d join public.tickets_pesaje tp on tp.id = d.ticket_id
--         where tp.almacen_id = p_almacen_id and tp.tipo = 'venta'
--           and coalesce(nullif(d.destino_tipo, ''), 'mpp') <> 'lote'
--         union all
--         select producto_id, greatest(diferencia, 0), greatest(-diferencia, 0)
--         from public.ajustes_inventario
--         where almacen_id = p_almacen_id and lote_id is null
--         union all
--         select ted.producto_id, 0::numeric, coalesce(ted.peso_kg, 0)
--         from public.transformacion_entrada_detalle ted
--         join public.transformaciones t on t.id = ted.transformacion_id
--         where t.almacen_id = p_almacen_id and t.categoria = 'ferroso_no_ferroso'
--         union all
--         select tsd.producto_id, coalesce(tsd.peso_neto, 0), 0::numeric
--         from public.transformacion_salida_detalle tsd
--         join public.transformaciones t on t.id = tsd.transformacion_id
--         where t.almacen_id = p_almacen_id and t.categoria = 'ferroso_no_ferroso' and t.estado = 'completa'
--       ) x where producto_id is not null group by producto_id
--     ),
--     con_lote as (
--       select slp.producto_id, sum(slp.stock) as stock
--       from public.lotes l
--       cross join lateral public.stock_lote_almacen_por_producto(l.id, p_almacen_id) slp
--       group by slp.producto_id
--     )
--     select producto_id, sum(stock) as stock
--     from (
--       select * from sin_lote
--       union all
--       select * from con_lote
--     ) z
--     group by producto_id;
--   $function$;
--
-- stock_lote_por_producto
--   CREATE OR REPLACE FUNCTION public.stock_lote_por_producto(p_lote_id uuid)
--    RETURNS TABLE(producto_id uuid, stock numeric)
--    LANGUAGE sql
--    STABLE
--   AS $function$
--     with transformacion_totales as (
--       select transformacion_id, sum(peso_kg) as total_entrada
--       from public.transformacion_entrada_detalle
--       group by transformacion_id
--     ),
--     salida_distribuida as (
--       -- reparte cada salida hacia un lote_destino proporcionalmente a la
--       -- composición de entrada de esa misma transformación
--       select tsd.lote_destino_id as lote_id,
--              ted.producto_id,
--              tsd.peso_neto * ted.peso_kg / tt.total_entrada as monto
--       from public.transformacion_salida_detalle tsd
--       join transformacion_totales tt on tt.transformacion_id = tsd.transformacion_id
--       join public.transformacion_entrada_detalle ted on ted.transformacion_id = tsd.transformacion_id
--       where tsd.lote_destino_id is not null
--         and tt.total_entrada > 0
--     )
--     select producto_id, sum(entrada) - sum(salida) as stock
--     from (
--       select d.producto_id, coalesce(d.peso_neto, 0) as entrada, 0::numeric as salida
--       from public.detalle_tickets_pesaje d
--       join public.tickets_pesaje tp on tp.id = d.ticket_id
--       where d.destino_tipo = 'lote' and d.lote_id = p_lote_id and tp.tipo = 'compra'
--       union all
--       select d.producto_id, 0::numeric, coalesce(d.peso_neto, 0)
--       from public.detalle_tickets_pesaje d
--       join public.tickets_pesaje tp on tp.id = d.ticket_id
--       where d.destino_tipo = 'lote' and d.lote_id = p_lote_id and tp.tipo = 'venta'
--       union all
--       select ted.producto_id, 0::numeric, coalesce(ted.peso_kg, 0)
--       from public.transformacion_entrada_detalle ted
--       join public.transformaciones t on t.id = ted.transformacion_id
--       where t.lote_origen_id = p_lote_id
--       union all
--       select ai.producto_id,
--              case when ai.diferencia > 0 then ai.diferencia else 0 end,
--              case when ai.diferencia < 0 then -ai.diferencia else 0 end
--       from public.ajustes_inventario ai
--       where ai.lote_id = p_lote_id
--         and ai.producto_id is not null
--       union all
--       -- NUEVO: composición heredada del origen para lotes que recibieron
--       -- material vía transformación (PCB/legacy)
--       select producto_id, monto, 0::numeric
--       from salida_distribuida
--       where lote_id = p_lote_id and producto_id is not null
--     ) x
--     where producto_id is not null
--     group by producto_id;
--   $function$;
--
-- stock_lote_almacen_por_producto
--   CREATE OR REPLACE FUNCTION public.stock_lote_almacen_por_producto(p_lote_id uuid, p_almacen_id uuid)
--    RETURNS TABLE(producto_id uuid, stock numeric)
--    LANGUAGE sql
--    STABLE
--   AS $function$
--     with transformacion_totales as (
--       select transformacion_id, sum(peso_kg) as total_entrada
--       from public.transformacion_entrada_detalle
--       group by transformacion_id
--     ),
--     salida_distribuida as (
--       select tsd.lote_destino_id as lote_id, tsd.almacen_id,
--              ted.producto_id,
--              tsd.peso_neto * ted.peso_kg / tt.total_entrada as monto
--       from public.transformacion_salida_detalle tsd
--       join transformacion_totales tt on tt.transformacion_id = tsd.transformacion_id
--       join public.transformacion_entrada_detalle ted on ted.transformacion_id = tsd.transformacion_id
--       where tsd.lote_destino_id is not null and tt.total_entrada > 0
--     )
--     select producto_id, sum(entrada) - sum(salida) as stock
--     from (
--       -- compras directas al lote, en ESTE almacén
--       select d.producto_id, coalesce(d.peso_neto, 0) as entrada, 0::numeric as salida
--       from public.detalle_tickets_pesaje d
--       join public.tickets_pesaje tp on tp.id = d.ticket_id
--       where d.destino_tipo = 'lote' and d.lote_id = p_lote_id and tp.tipo = 'compra' and tp.almacen_id = p_almacen_id
--       union all
--       -- ventas directas del lote, en ESTE almacén
--       select d.producto_id, 0::numeric, coalesce(d.peso_neto, 0)
--       from public.detalle_tickets_pesaje d
--       join public.tickets_pesaje tp on tp.id = d.ticket_id
--       where d.destino_tipo = 'lote' and d.lote_id = p_lote_id and tp.tipo = 'venta' and tp.almacen_id = p_almacen_id
--       union all
--       -- transformación PCB que consumió este lote DESDE este almacén
--       select ted.producto_id, 0::numeric, coalesce(ted.peso_kg, 0)
--       from public.transformacion_entrada_detalle ted
--       join public.transformaciones t on t.id = ted.transformacion_id
--       where t.lote_origen_id = p_lote_id and t.almacen_id = p_almacen_id
--       union all
--       -- ajustes de toma física / manuales, en ESTE almacén, con producto
--       select ai.producto_id,
--              case when ai.diferencia > 0 then ai.diferencia else 0 end,
--              case when ai.diferencia < 0 then -ai.diferencia else 0 end
--       from public.ajustes_inventario ai
--       where ai.lote_id = p_lote_id and ai.almacen_id = p_almacen_id and ai.producto_id is not null
--       union all
--       -- recibido de una transformación cuya salida quedó asignada a ESTE almacén
--       select producto_id, monto, 0::numeric
--       from salida_distribuida
--       where lote_id = p_lote_id and almacen_id = p_almacen_id and producto_id is not null
--       union all
--       -- traslado RECIBIDO: composición que llegó, escalada a lo efectivamente
--       -- recibido (puede diferir de lo despachado por discrepancia de pesaje).
--       select dtc.producto_id, dtc.peso_kg * (dt.peso_recibido / nullif(dt.peso_neto, 0)), 0::numeric
--       from public.detalle_traslado_composicion dtc
--       join public.detalle_traslado dt on dt.id = dtc.detalle_traslado_id
--       join public.tickets_traslado t on t.id = dt.traslado_id
--       where dt.lote_id = p_lote_id and t.almacen_destino_id = p_almacen_id and t.estado = 'completo'
--         and dtc.producto_id is not null
--       union all
--       -- traslado ENVIADO: composición que salió (snapshot al pesar) — se
--       -- descuenta desde que el traslado se CREA, igual que el peso total.
--       select dtc.producto_id, 0::numeric, dtc.peso_kg
--       from public.detalle_traslado_composicion dtc
--       join public.detalle_traslado dt on dt.id = dtc.detalle_traslado_id
--       join public.tickets_traslado t on t.id = dt.traslado_id
--       where dt.lote_id = p_lote_id and t.almacen_origen_id = p_almacen_id and t.estado in ('pendiente', 'completo')
--         and dtc.producto_id is not null
--     ) x
--     where producto_id is not null
--     group by producto_id;
--   $function$;
--
-- stock_lote_total
--   CREATE OR REPLACE FUNCTION public.stock_lote_total(p_lote_id uuid)
--    RETURNS numeric
--    LANGUAGE sql
--    STABLE
--   AS $function$
--     with transformacion_totales as (
--       select transformacion_id, sum(peso_kg) as total_entrada
--       from public.transformacion_entrada_detalle
--       group by transformacion_id
--     ),
--     -- porción de cada salida que corresponde a material "sin desglose" (producto_id NULL)
--     -- del lote origen — se suma aparte porque stock_lote_por_producto solo devuelve producto_id NOT NULL
--     salida_null_distribuida as (
--       select tsd.lote_destino_id as lote_id,
--              tsd.peso_neto * ted_null.peso_kg / tt.total_entrada as monto
--       from public.transformacion_salida_detalle tsd
--       join transformacion_totales tt on tt.transformacion_id = tsd.transformacion_id
--       join public.transformacion_entrada_detalle ted_null
--         on ted_null.transformacion_id = tsd.transformacion_id and ted_null.producto_id is null
--       where tsd.lote_destino_id is not null
--         and tt.total_entrada > 0
--     ),
--     -- simétrico del anterior: la porción "sin desglose" que salió de ESTE lote
--     -- como origen de una transformación nunca aparece en
--     -- stock_lote_por_producto() (que solo devuelve producto_id NOT NULL), así
--     -- que hay que restarla aparte.
--     retiro_null_origen as (
--       select coalesce(sum(ted.peso_kg), 0) as monto
--       from public.transformacion_entrada_detalle ted
--       join public.transformaciones t on t.id = ted.transformacion_id
--       where t.lote_origen_id = p_lote_id
--         and ted.producto_id is null
--     )
--     select coalesce((select sum(stock) from public.stock_lote_por_producto(p_lote_id)), 0)
--          + coalesce((select sum(monto) from salida_null_distribuida where lote_id = p_lote_id), 0)
--          - coalesce((select monto from retiro_null_origen), 0)
--          + coalesce((
--              select sum(ai.diferencia)
--              from public.ajustes_inventario ai
--              where ai.lote_id = p_lote_id
--                and ai.producto_id is null
--            ), 0);
--   $function$;
--
-- CÓMO APLICAR: Supabase SQL Editor, con backup previo. Es idempotente.
-- =============================================================================

-- 1. RPC nueva ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.completar_transformacion_mixta(
  p_transformacion_id uuid,
  p_salidas jsonb,
  p_completado_por uuid
)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_categoria         text;
  v_estado            text;
  v_lote_origen_id    uuid;
  v_almacen_trans     uuid;
  v_peso_neto_entrada numeric;
  v_item              jsonb;
  v_tipo              text;
  v_producto          uuid;
  v_lote_destino      uuid;
  v_almacen           uuid;
  v_peso_bruto        numeric;
  v_tara              numeric;
  v_neto              numeric;
  v_suma_salidas      numeric := 0;
  v_fotos             text[];
  v_salidas_norm      jsonb := '[]'::jsonb;
begin
  select t.categoria, t.estado, t.lote_origen_id, t.almacen_id, t.peso_neto
    into v_categoria, v_estado, v_lote_origen_id, v_almacen_trans, v_peso_neto_entrada
    from public.transformaciones t
   where t.id = p_transformacion_id
     for update;

  if v_categoria is null then
    raise exception 'Transformación no encontrada.';
  end if;
  if v_categoria not in ('pcb', 'ferroso_no_ferroso') then
    raise exception 'Categoría de transformación no soportada: %.', v_categoria;
  end if;
  if v_estado <> 'bruto' then
    raise exception 'Esta transformación ya fue completada.';
  end if;

  if p_salidas is null or jsonb_typeof(p_salidas) <> 'array' or jsonb_array_length(p_salidas) = 0 then
    raise exception 'Agrega al menos una salida.';
  end if;

  -- Validación y normalización (no se inserta nada hasta validar todo).
  for v_item in select value from jsonb_array_elements(p_salidas) as elems(value)
  loop
    v_tipo         := v_item->>'tipo';
    begin
      v_producto     := nullif(v_item->>'producto_id', '')::uuid;
      v_lote_destino := nullif(v_item->>'lote_destino_id', '')::uuid;
      v_almacen      := nullif(v_item->>'almacen_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'producto_id, lote_destino_id o almacen_id de una salida no es un uuid válido.';
    end;
    begin
      v_peso_bruto := nullif(v_item->>'peso_bruto', '')::numeric;
      v_tara       := coalesce(nullif(v_item->>'tara', '')::numeric, 0);
    exception when invalid_text_representation then
      raise exception 'peso_bruto o tara de una salida no es un número válido.';
    end;

    if v_tipo is null or v_tipo not in ('material', 'lote') then
      raise exception 'Cada salida debe indicar tipo ''material'' o ''lote''.';
    end if;
    if v_peso_bruto is null
       or v_peso_bruto in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
       or v_tara in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
       or v_tara < 0 then
      raise exception 'Peso bruto o tara inválidos en una salida.';
    end if;
    v_neto := v_peso_bruto - v_tara;
    if round(v_neto, 2) <= 0 then
      raise exception 'El peso neto de cada salida debe ser mayor a 0.';
    end if;

    if v_categoria = 'pcb' and v_tipo = 'lote' then
      if v_lote_destino is null then
        raise exception 'Cada salida de tipo lote necesita lote_destino_id.';
      end if;
      if v_lote_destino = v_lote_origen_id then
        raise exception 'El lote destino debe ser distinto del lote origen.';
      end if;
      if v_almacen is null then
        raise exception 'Cada salida a lote necesita almacen_id.';
      end if;
      v_producto := null;                       -- tipo B: composición heredada
    elsif v_categoria = 'pcb' and v_tipo = 'material' then
      if v_producto is null then
        raise exception 'Cada salida de tipo material necesita producto_id.';
      end if;
      if v_almacen is null then
        raise exception 'Cada salida de tipo material necesita almacen_id.';
      end if;
      v_lote_destino := null;                   -- tipo A
    elsif v_tipo = 'material' then              -- ferroso + material
      if v_producto is null then
        raise exception 'Cada salida de tipo material necesita producto_id.';
      end if;
      v_almacen := coalesce(v_almacen, v_almacen_trans);
      v_lote_destino := null;                   -- tipo A
    else                                        -- ferroso + lote (tipo C)
      if v_producto is null or v_lote_destino is null or v_almacen is null then
        raise exception 'Una salida ferroso a lote necesita producto_id, lote_destino_id y almacen_id.';
      end if;
    end if;

    if v_categoria = 'ferroso_no_ferroso'
       and (case when jsonb_typeof(v_item->'fotos') = 'array'
                 then jsonb_array_length(v_item->'fotos') else 0 end) = 0 then
      raise exception 'Cada salida necesita al menos una foto.';
    end if;

    if v_lote_destino is not null
       and not exists (select 1 from public.lotes where id = v_lote_destino and activo) then
      raise exception 'Lote destino % no encontrado o archivado.', v_lote_destino;
    end if;
    if v_almacen is not null
       and not exists (select 1 from public.almacenes where id = v_almacen and activo) then
      raise exception 'Almacén destino % no encontrado o inactivo.', v_almacen;
    end if;
    if v_producto is not null
       and not exists (select 1 from public.productos where id = v_producto and activo) then
      raise exception 'Producto % no encontrado o inactivo.', v_producto;
    end if;

    v_suma_salidas := v_suma_salidas + v_neto;
    v_salidas_norm := v_salidas_norm || jsonb_build_array(jsonb_build_object(
      'producto_id',     v_producto,
      'lote_destino_id', v_lote_destino,
      'almacen_id',      v_almacen,
      'peso_bruto',      v_peso_bruto,
      'tara',            v_tara,
      'fotos',           case when jsonb_typeof(v_item->'fotos') = 'array' then v_item->'fotos' else '[]'::jsonb end
    ));
  end loop;

  if v_suma_salidas > v_peso_neto_entrada + 0.01 then
    raise exception 'La suma de las salidas (%) supera el peso neto de entrada (%).',
      round(v_suma_salidas, 2), round(v_peso_neto_entrada, 2);
  end if;

  for v_item in select value from jsonb_array_elements(v_salidas_norm) as elems(value)
  loop
    v_fotos := coalesce(array(select jsonb_array_elements_text(v_item->'fotos')), '{}');
    insert into public.transformacion_salida_detalle
      (transformacion_id, producto_id, lote_destino_id, almacen_id, peso_bruto, tara, fotos)
    values (
      p_transformacion_id,
      nullif(v_item->>'producto_id', '')::uuid,
      nullif(v_item->>'lote_destino_id', '')::uuid,
      nullif(v_item->>'almacen_id', '')::uuid,
      (v_item->>'peso_bruto')::numeric,
      (v_item->>'tara')::numeric,
      v_fotos
    );
  end loop;

  update public.transformaciones
     set estado = 'completa', completado_por = p_completado_por, completado_en = now()
   where id = p_transformacion_id;
end;
$function$
;

-- Solo el backend (service_role) debe poder invocarla.
REVOKE EXECUTE ON FUNCTION public.completar_transformacion_mixta(uuid, jsonb, uuid) FROM public, anon, authenticated;

-- 2. stock_almacen -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stock_almacen(p_almacen_id uuid)
 RETURNS TABLE(producto_id uuid, stock numeric)
 LANGUAGE sql
 STABLE
AS $function$
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
      -- material suelto (A): producto sin lote destino, en el almacén de la
      -- salida (o el de la transformación si la salida no lo indica). Aplica a
      -- ferroso y PCB. Las salidas a lote (B/C) las cuenta la rama con_lote.
      where coalesce(tsd.almacen_id, t.almacen_id) = p_almacen_id
        and tsd.lote_destino_id is null and tsd.producto_id is not null
        and t.estado = 'completa'
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
$function$;

-- 3a. stock_lote_por_producto ------------------------------------------------
CREATE OR REPLACE FUNCTION public.stock_lote_por_producto(p_lote_id uuid)
 RETURNS TABLE(producto_id uuid, stock numeric)
 LANGUAGE sql
 STABLE
AS $function$
  with transformacion_totales as (
    select transformacion_id, sum(peso_kg) as total_entrada
    from public.transformacion_entrada_detalle
    group by transformacion_id
  ),
  salida_distribuida as (
    -- reparte cada salida hacia un lote_destino proporcionalmente a la
    -- composición de entrada de esa misma transformación
    select tsd.lote_destino_id as lote_id,
           ted.producto_id,
           tsd.peso_neto * ted.peso_kg / tt.total_entrada as monto
    from public.transformacion_salida_detalle tsd
    join transformacion_totales tt on tt.transformacion_id = tsd.transformacion_id
    join public.transformacion_entrada_detalle ted on ted.transformacion_id = tsd.transformacion_id
    where tsd.lote_destino_id is not null
      and tsd.producto_id is null
      and tt.total_entrada > 0
  )
  select producto_id, sum(entrada) - sum(salida) as stock
  from (
    select d.producto_id, coalesce(d.peso_neto, 0) as entrada, 0::numeric as salida
    from public.detalle_tickets_pesaje d
    join public.tickets_pesaje tp on tp.id = d.ticket_id
    where d.destino_tipo = 'lote' and d.lote_id = p_lote_id and tp.tipo = 'compra'
    union all
    select d.producto_id, 0::numeric, coalesce(d.peso_neto, 0)
    from public.detalle_tickets_pesaje d
    join public.tickets_pesaje tp on tp.id = d.ticket_id
    where d.destino_tipo = 'lote' and d.lote_id = p_lote_id and tp.tipo = 'venta'
    union all
    select ted.producto_id, 0::numeric, coalesce(ted.peso_kg, 0)
    from public.transformacion_entrada_detalle ted
    join public.transformaciones t on t.id = ted.transformacion_id
    where t.lote_origen_id = p_lote_id
    union all
    select ai.producto_id,
           case when ai.diferencia > 0 then ai.diferencia else 0 end,
           case when ai.diferencia < 0 then -ai.diferencia else 0 end
    from public.ajustes_inventario ai
    where ai.lote_id = p_lote_id
      and ai.producto_id is not null
    union all
    -- NUEVO: composición heredada del origen para lotes que recibieron
    -- material vía transformación (PCB/legacy)
    select producto_id, monto, 0::numeric
    from salida_distribuida
    where lote_id = p_lote_id and producto_id is not null
    union all
    -- salida con producto explícito hacia este lote (tipo C, ferroso -> lote):
    -- composición directa, sin distribuir por la entrada
    select tsd.producto_id, coalesce(tsd.peso_neto, 0), 0::numeric
    from public.transformacion_salida_detalle tsd
    join public.transformaciones tr on tr.id = tsd.transformacion_id
    where tsd.lote_destino_id = p_lote_id and tsd.producto_id is not null
      and tr.estado = 'completa'
  ) x
  where producto_id is not null
  group by producto_id;
$function$;

-- 3b. stock_lote_almacen_por_producto ----------------------------------------
CREATE OR REPLACE FUNCTION public.stock_lote_almacen_por_producto(p_lote_id uuid, p_almacen_id uuid)
 RETURNS TABLE(producto_id uuid, stock numeric)
 LANGUAGE sql
 STABLE
AS $function$
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
    where tsd.lote_destino_id is not null and tsd.producto_id is null and tt.total_entrada > 0
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
    -- salida con producto explícito hacia este lote en ESTE almacén (tipo C)
    select tsd.producto_id, coalesce(tsd.peso_neto, 0), 0::numeric
    from public.transformacion_salida_detalle tsd
    join public.transformaciones tr on tr.id = tsd.transformacion_id
    where tsd.lote_destino_id = p_lote_id and tsd.almacen_id = p_almacen_id
      and tsd.producto_id is not null and tr.estado = 'completa'
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
$function$;

-- 4. stock_lote_total --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stock_lote_total(p_lote_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  with transformacion_totales as (
    select transformacion_id, sum(peso_kg) as total_entrada
    from public.transformacion_entrada_detalle
    group by transformacion_id
  ),
  -- porción de cada salida que corresponde a material "sin desglose" (producto_id NULL)
  -- del lote origen — se suma aparte porque stock_lote_por_producto solo devuelve producto_id NOT NULL
  salida_null_distribuida as (
    select tsd.lote_destino_id as lote_id,
           tsd.peso_neto * ted_null.peso_kg / tt.total_entrada as monto
    from public.transformacion_salida_detalle tsd
    join transformacion_totales tt on tt.transformacion_id = tsd.transformacion_id
    join public.transformacion_entrada_detalle ted_null
      on ted_null.transformacion_id = tsd.transformacion_id and ted_null.producto_id is null
    where tsd.lote_destino_id is not null
      and tsd.producto_id is null
      and tt.total_entrada > 0
  ),
  -- simétrico del anterior: la porción "sin desglose" que salió de ESTE lote
  -- como origen de una transformación nunca aparece en
  -- stock_lote_por_producto() (que solo devuelve producto_id NOT NULL), así
  -- que hay que restarla aparte.
  retiro_null_origen as (
    select coalesce(sum(ted.peso_kg), 0) as monto
    from public.transformacion_entrada_detalle ted
    join public.transformaciones t on t.id = ted.transformacion_id
    where t.lote_origen_id = p_lote_id
      and ted.producto_id is null
  )
  select coalesce((select sum(stock) from public.stock_lote_por_producto(p_lote_id)), 0)
       + coalesce((select sum(monto) from salida_null_distribuida where lote_id = p_lote_id), 0)
       - coalesce((select monto from retiro_null_origen), 0)
       + coalesce((
           select sum(ai.diferencia)
           from public.ajustes_inventario ai
           where ai.lote_id = p_lote_id
             and ai.producto_id is null
         ), 0);
$function$;
