-- =============================================================================
-- Punto 4.3 del plan de mejoras (sep-2026): descuento de peso al facturar
-- una compra (merma/tara adicional aplicada en la factura, no en el pesaje).
--
-- Diseño: `detalle_facturas_compra.peso` sigue siendo el peso YA FACTURADO
-- (bruto - descuento) para que `subtotal` (columna generada, peso *
-- precio_unitario) siga funcionando sin tocarla. `descuento_kg` es una
-- columna nueva, informativa, para mostrar cuánto se descontó.
--
-- CÓMO APLICAR: pegar en Supabase Studio → SQL Editor y ejecutar (o vía
-- Management API, como se hizo en migraciones anteriores de esta sesión).
-- =============================================================================

alter table public.detalle_facturas_compra
  add column if not exists descuento_kg numeric not null default 0;

create or replace function public.crear_factura_compra(
  p_proveedor_id  uuid,
  p_ticket_ids    uuid[],
  p_estado        text,
  p_descripcion   text,
  p_observaciones text,
  p_items         jsonb
) returns uuid
language plpgsql
as $$
declare
  v_id     uuid;
  v_item   jsonb;
  v_total  numeric;
  v_ticket uuid;
begin
  -- Preservado de la versión en producción: no se puede facturar un ticket
  -- cuyo material está bloqueado por una toma física de inventario abierta.
  if p_ticket_ids is not null and exists (
    select 1
    from public.detalle_tickets_pesaje dt
    join public.tickets_pesaje tp on tp.id = dt.ticket_id
    where tp.id = any(p_ticket_ids)
      and public.hay_toma_fisica_abierta(tp.almacen_id, dt.producto_id, dt.lote_id)
  ) then
    raise exception 'Uno de los materiales de estos tickets tiene una toma física de inventario abierta. No se puede facturar hasta cerrarla.';
  end if;

  select coalesce(round(sum(
    ((value->>'peso')::numeric - coalesce((value->>'descuento_kg')::numeric, 0))
    * (value->>'precio_unitario')::numeric
  ), 2), 0)
    into v_total
  from jsonb_array_elements(p_items) as elems(value);

  insert into public.facturas_compra
    (proveedor_id, ticket_id, precio_unitario, total, descripcion, observaciones, estado)
  values (
    p_proveedor_id, null, 0, v_total,
    nullif(p_descripcion, ''), nullif(p_observaciones, ''), coalesce(p_estado, 'emitida')
  )
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(p_items) as elems(value)
  loop
    insert into public.detalle_facturas_compra (factura_id, producto_id, peso, precio_unitario, descuento_kg)
    values (
      v_id,
      (v_item->>'producto_id')::uuid,
      (v_item->>'peso')::numeric - coalesce((v_item->>'descuento_kg')::numeric, 0),
      (v_item->>'precio_unitario')::numeric,
      coalesce((v_item->>'descuento_kg')::numeric, 0)
    );
  end loop;

  if p_ticket_ids is not null then
    foreach v_ticket in array p_ticket_ids
    loop
      insert into public.facturas_compra_tickets (factura_id, ticket_id)
      values (v_id, v_ticket)
      on conflict do nothing;
      update public.tickets_pesaje set facturado = true where id = v_ticket;
    end loop;
  end if;

  return v_id;
end;
$$;
