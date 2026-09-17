-- =============================================================================
-- MIGRACIÓN: bloqueos (FOR UPDATE) para prevenir condiciones de carrera en
-- traslados y culminación de toma física.
--
-- PROBLEMA: crear_traslado(), completar_traslado() y
-- culminar_toma_fisica_inventario() leían el stock/estado a validar SIN
-- bloquear la fila correspondiente — a diferencia de crear_transformacion()/
-- crear_transformacion_pcb(), que sí hacen `select ... for update` sobre el
-- lote origen desde el principio. Con dos operaciones concurrentes sobre el
-- mismo lote/almacén (dos traslados, o un traslado y una toma física, o dos
-- clics de "completar" sobre el mismo traslado), ambas podían leer el mismo
-- estado "antes" del cambio y proceder, dejando stock negativo real aunque
-- cada validación individual haya pasado.
--
-- FIX:
-- - crear_traslado(): bloquea la fila de `almacenes` del origen antes de
--   validar stock_almacen().
-- - completar_traslado(): bloquea la fila de `tickets_traslado` que va a
--   completar (evita doble-recepción del mismo traslado en paralelo).
-- - culminar_toma_fisica_inventario(): bloquea la fila de
--   `tomas_fisicas_inventario` (evita doble-culminación) y la de
--   `almacenes` correspondiente; y bloquea cada `lote` individual justo
--   antes de leer su composición en vivo para el ajuste "sin desglose"
--   (mismo patrón que ya usan crear_transformacion/crear_transformacion_pcb).
--
-- Orden de bloqueo verificado sin riesgo de deadlock: cada función bloquea
-- como máximo una fila de `almacenes` por llamada, y culminar_toma_fisica
-- bloquea lotes en el mismo orden determinístico que ya usa
-- resumen_toma_fisica() (por nombre), así que dos culminaciones
-- concurrentes siempre bloquean en el mismo orden relativo entre sí.
--
-- CÓMO APLICAR: pegar en Supabase Studio → SQL Editor y ejecutar.
-- =============================================================================

create or replace function public.crear_traslado(p_almacen_origen_id uuid, p_almacen_destino_id uuid, p_observaciones text, p_materiales jsonb, p_pesado_por uuid)
 returns uuid
 language plpgsql
as $function$
declare
  v_id   uuid;
  v_item jsonb;
  v_prod record;
  v_disponible numeric;
  v_nombre text;
begin
  if p_almacen_origen_id = p_almacen_destino_id then
    raise exception 'El almacén de origen y destino no pueden ser el mismo.';
  end if;

  -- Bloquea el almacén de origen antes de validar/descontar stock, para que
  -- dos traslados concurrentes del mismo almacén no lean el mismo stock
  -- "disponible" y ambos procedan.
  perform 1 from public.almacenes where id = p_almacen_origen_id for update;

  for v_item in select value from jsonb_array_elements(coalesce(p_materiales, '[]'::jsonb)) as elems(value)
  loop
    if public.hay_toma_fisica_abierta(p_almacen_origen_id, (v_item->>'producto_id')::uuid)
       or public.hay_toma_fisica_abierta(p_almacen_destino_id, (v_item->>'producto_id')::uuid) then
      raise exception 'Uno de los materiales tiene una toma física de inventario abierta en el origen o el destino. No se pueden registrar traslados hasta cerrarla.';
    end if;
  end loop;

  -- Validar stock suficiente en el almacén origen por producto, sumando
  -- filas repetidas del mismo producto (distintas subcategorías) dentro del
  -- mismo traslado antes de descontar nada.
  for v_prod in
    select (elems.value->>'producto_id')::uuid as producto_id,
           sum((elems.value->>'peso_bruto')::numeric - coalesce((elems.value->>'tara')::numeric, 0)) as neto_solicitado
    from jsonb_array_elements(coalesce(p_materiales, '[]'::jsonb)) as elems(value)
    group by (elems.value->>'producto_id')::uuid
  loop
    select coalesce(stock, 0) into v_disponible
      from public.stock_almacen(p_almacen_origen_id)
     where producto_id = v_prod.producto_id;

    if v_prod.neto_solicitado > coalesce(v_disponible, 0) + 0.01 then
      select nombre into v_nombre from public.productos where id = v_prod.producto_id;
      raise exception 'Solo hay % kg disponibles de % en el almacén de origen.', round(coalesce(v_disponible, 0), 2), coalesce(v_nombre, 'este material');
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
$function$;

create or replace function public.completar_traslado(p_traslado_id uuid, p_recepciones jsonb, p_fotos text[], p_completado_por uuid)
 returns uuid
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

  for v_fila in select producto_id from public.detalle_traslado where traslado_id = p_traslado_id
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
    select dt.peso_neto, p.nombre into v_peso_neto, v_nombre
      from public.detalle_traslado dt
      join public.productos p on p.id = dt.producto_id
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
  -- Bloquea la toma física (evita doble-culminación concurrente) y el
  -- almacén asociado (serializa contra crear_traslado del mismo almacén).
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
      -- Bloquea el lote antes de leer su composición en vivo — mismo
      -- patrón que crear_transformacion/crear_transformacion_pcb, para que
      -- una transformación concurrente sobre este mismo lote no cambie la
      -- composición a mitad de este cálculo.
      perform 1 from public.lotes where id = v_fila.lote_id for update;

      if v_fila.stock_teorico > 0.01 then
        v_factor := (v_fila.stock_teorico + v_fila.diferencia) / v_fila.stock_teorico;

        -- IMPORTANTE: v_total_comp/v_null_actual se calculan ANTES de
        -- insertar cualquier ajuste nuevo. stock_lote_por_producto() es una
        -- vista en vivo sobre ajustes_inventario — si se calculara después
        -- del loop (que ya insertó filas), leería su propio resultado a
        -- mitad de transacción y el residuo "sin desglose" saldría mal.
        select coalesce(sum(stock), 0) into v_total_comp
          from public.stock_lote_por_producto(v_fila.lote_id);
        v_null_actual := v_fila.stock_teorico - v_total_comp;

        for v_comp in select * from public.stock_lote_por_producto(v_fila.lote_id)
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

-- VERIFICACIÓN: confirma que las 3 funciones existen y compilan sin error
-- (el CREATE OR REPLACE de arriba ya lo hace; esto es solo para inspección
-- manual si se quiere ver la definición aplicada):
-- select proname, pg_get_functiondef(oid) from pg_proc
-- where proname in ('crear_traslado','completar_traslado','culminar_toma_fisica_inventario');
