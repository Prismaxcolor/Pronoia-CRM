-- =============================================================================
-- Edición de tickets de pesaje con llave: más poderes.
--
-- Datos: reemplaza la función editar_ticket_pesaje (no toca tablas ni filas).
-- Importador: backend/src/services/ticket-pesaje-service.ts (editarTicket).
-- Instrucción del usuario: "la llave debe ser una herramienta que realmente
-- dé poderes" (editar pesajes, pesos, tara, material; dejar historial).
--
-- Qué agrega sobre la versión anterior (7 parámetros):
--   p_fecha               date    : corrige la fecha del ticket.
--   p_pesajes_globales    jsonb   : reemplaza las pesadas del camión
--                                   [{peso, tara, fotos}] y fija peso_global =
--                                   suma(peso - tara). null = no tocar.
--   p_permitir_facturado  boolean : permite editar un ticket ya facturado
--                                   (el backend solo lo pasa con llave válida
--                                   o superadmin). La FACTURA NO SE RECALCULA.
--
-- Compatibilidad: el backend solo envía los parámetros nuevos cuando aplican;
-- mientras no se aplique esta migración las ediciones comunes siguen
-- funcionando y las que usan lo nuevo responden con un mensaje claro.
--
-- ROLLBACK: eliminar la función de 10 parámetros y volver a crear la de 7
-- (docs/sql/functions/editar_ticket_pesaje.sql + p_vehiculo).
--
-- CÓMO APLICAR: Supabase SQL Editor, con backup previo, primero en staging.
-- =============================================================================

begin;

drop function if exists public.editar_ticket_pesaje(uuid, jsonb, numeric, text, numeric, text[], text);

create or replace function public.editar_ticket_pesaje(
  p_ticket_id uuid,
  p_materiales jsonb,
  p_peso_global numeric default null,
  p_observaciones text default null,
  p_devolucion numeric default null,
  p_fotos_devolucion text[] default null,
  p_vehiculo text default null,
  p_fecha date default null,
  p_pesajes_globales jsonb default null,
  p_permitir_facturado boolean default false
)
 returns uuid
 language plpgsql
as $function$
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

commit;
