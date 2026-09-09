-- =============================================================================
-- MIGRACIÓN: el almacén de origen descuenta el material de un traslado desde
--            que se CREA (pesado y en tránsito), no solo cuando se completa
--            (recibido). Y completar_traslado() valida que no se reciba más
--            peso del que salió.
--
-- PROBLEMA 1: stock_almacen() solo restaba el traslado del almacén origen
-- cuando estado = 'completo'. Mientras un traslado está 'pendiente' (ya
-- pesado y en camino), el material sigue contando como disponible en el
-- almacén de origen — se podía crear un SEGUNDO traslado o transformación
-- con el mismo material que ya está físicamente en tránsito, sobre-asignando
-- el mismo stock dos veces. Mismo tipo de bug que ya se corrigió para
-- transformaciones (que sí descuentan el origen desde la creación).
--
-- PROBLEMA 2: completar_traslado() escribía peso_recibido sin validar nada
-- contra lo que salió (peso_neto) — se podía "recibir" más kg de los que se
-- despacharon, fabricando masa de la nada.
--
-- CÓMO APLICAR: pegar en Supabase Studio → SQL Editor y ejecutar.
-- =============================================================================

create or replace function public.stock_almacen(p_almacen_id uuid)
returns table(producto_id uuid, stock numeric)
language sql
stable
as $function$
 select producto_id, sum(entrada) - sum(salida) as stock from (
   select dt.producto_id, coalesce(dt.peso_recibido, 0) as entrada, 0::numeric as salida
   from public.detalle_traslado dt join public.tickets_traslado t on t.id = dt.traslado_id
   where t.almacen_destino_id = p_almacen_id and t.estado = 'completo'
   union all
   -- el origen descuenta desde que el traslado se CREA (pendiente o
   -- completo): el material ya salió físicamente, no está disponible para
   -- otro traslado/transformación aunque todavía no se haya confirmado la
   -- recepción.
   select dt.producto_id, 0::numeric, coalesce(dt.peso_neto, 0)
   from public.detalle_traslado dt join public.tickets_traslado t on t.id = dt.traslado_id
   where t.almacen_origen_id = p_almacen_id and t.estado in ('pendiente', 'completo')
   union all
   select d.producto_id, coalesce(d.peso_neto, 0), 0::numeric
   from public.detalle_tickets_pesaje d join public.tickets_pesaje tp on tp.id = d.ticket_id
   where tp.almacen_id = p_almacen_id and tp.tipo = 'compra'
   union all
   select d.producto_id, 0::numeric, coalesce(d.peso_neto, 0)
   from public.detalle_tickets_pesaje d join public.tickets_pesaje tp on tp.id = d.ticket_id
   where tp.almacen_id = p_almacen_id and tp.tipo = 'venta'
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
 ) x where producto_id is not null group by producto_id;
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
  select estado, almacen_origen_id, almacen_destino_id
    into v_estado, v_almacen_origen_id, v_almacen_destino_id
    from public.tickets_traslado where id = p_traslado_id;

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
