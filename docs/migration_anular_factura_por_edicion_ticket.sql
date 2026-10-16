-- ============================================================================
-- Anulación de facturas al editar un ticket facturado con llave de edición
-- ----------------------------------------------------------------------------
-- Regla de negocio:
--   * Editar un ticket ya facturado (con llave) ANULA la factura que lo contiene
--     si está en 'borrador'/'emitida' y no tiene pagos aplicados. La factura se
--     conserva (número, líneas, totales) con estado 'anulada' para historial, y
--     los tickets quedan libres (facturado = false, sin fila en la tabla puente)
--     para volver a facturarse con los datos corregidos.
--   * Si la factura está 'pagada' o tiene pagos aplicados (monto_pagado > 0 o
--     filas en pago_aplicaciones) NO se toca; la edición se guarda y el backend
--     avisa al usuario para que revise el estado de cuenta.
--
-- Objetos:
--   1. CHECK de estado ampliado con 'anulada' en facturas_compra / facturas_venta.
--   2. Columnas de auditoría: anulada_at, anulada_motivo, anulada_ticket_ids.
--   3. Trigger que impide pagar o modificar una factura 'anulada' (las RPC de
--      pago/cobro actualizan monto_pagado/estado: fallan con mensaje claro).
--   4. anular_facturas_de_ticket(ticket, motivo): decide y ejecuta, devuelve jsonb.
--   5. editar_ticket_con_factura(...): editar_ticket_pesaje + anulación en UNA
--      transacción (una función plpgsql es atómica: si algo falla, nada queda a medias).
--
-- Idempotente: se puede aplicar más de una vez.
--
-- ROLLBACK (en este orden):
--   drop function if exists public.editar_ticket_con_factura(uuid, jsonb, numeric, text, numeric, text[], text, date, jsonb, boolean, text);
--   drop function if exists public.anular_facturas_de_ticket(uuid, text);
--   drop trigger if exists trg_bloquear_factura_anulada on public.facturas_compra;
--   drop trigger if exists trg_bloquear_factura_anulada on public.facturas_venta;
--   drop function if exists public.fn_bloquear_factura_anulada();
--   -- Solo si NO hay facturas anuladas (si las hay, decidir antes qué hacer con ellas):
--   alter table public.facturas_compra drop constraint if exists facturas_compra_estado_check;
--   alter table public.facturas_compra add constraint facturas_compra_estado_check
--     check (estado in ('borrador','emitida','pagada'));
--   alter table public.facturas_venta drop constraint if exists facturas_venta_estado_check;
--   alter table public.facturas_venta add constraint facturas_venta_estado_check
--     check (estado in ('borrador','emitida','pagada'));
--   alter table public.facturas_compra drop column if exists anulada_at, drop column if exists anulada_motivo, drop column if exists anulada_ticket_ids;
--   alter table public.facturas_venta  drop column if exists anulada_at, drop column if exists anulada_motivo, drop column if exists anulada_ticket_ids;
-- ============================================================================

begin;

-- 1. Estado 'anulada' ---------------------------------------------------------
alter table public.facturas_compra drop constraint if exists facturas_compra_estado_check;
alter table public.facturas_compra add constraint facturas_compra_estado_check
  check (estado in ('borrador', 'emitida', 'pagada', 'anulada'));

alter table public.facturas_venta drop constraint if exists facturas_venta_estado_check;
alter table public.facturas_venta add constraint facturas_venta_estado_check
  check (estado in ('borrador', 'emitida', 'pagada', 'anulada'));

-- 2. Auditoría de la anulación -------------------------------------------------
alter table public.facturas_compra
  add column if not exists anulada_at         timestamptz,
  add column if not exists anulada_motivo     text,
  add column if not exists anulada_ticket_ids uuid[];

alter table public.facturas_venta
  add column if not exists anulada_at         timestamptz,
  add column if not exists anulada_motivo     text,
  add column if not exists anulada_ticket_ids uuid[];

-- 3. Una factura anulada no admite pagos ni cambios de estado/monto -----------
create or replace function public.fn_bloquear_factura_anulada()
returns trigger
language plpgsql
as $$
begin
  if old.estado = 'anulada' and (
       new.estado       is distinct from old.estado
    or new.monto_pagado is distinct from old.monto_pagado
    or new.total        is distinct from old.total
  ) then
    raise exception 'La factura N° % está anulada: no se puede pagar ni modificar.', old.numero;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bloquear_factura_anulada on public.facturas_compra;
create trigger trg_bloquear_factura_anulada
  before update on public.facturas_compra
  for each row execute function public.fn_bloquear_factura_anulada();

drop trigger if exists trg_bloquear_factura_anulada on public.facturas_venta;
create trigger trg_bloquear_factura_anulada
  before update on public.facturas_venta
  for each row execute function public.fn_bloquear_factura_anulada();

-- 4. Decide y ejecuta la anulación de las facturas que contienen el ticket ----
-- Devuelve un arreglo jsonb, un elemento por factura afectada:
--   { tipo: 'compra'|'venta', facturaId, numero, entidadId, total, montoPagado, estadoAnterior,
--     accion: 'anulada'|'pagada', ticketsLiberados }
-- 'pagada' significa "no se tocó porque tiene pagos" (estado 'pagada' o pagos aplicados).
create or replace function public.anular_facturas_de_ticket(p_ticket_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
as $$
declare
  r         record;
  v_res     jsonb := '[]'::jsonb;
  v_tickets uuid[];
  v_pagos   boolean;
begin
  -- Compras ------------------------------------------------------------------
  for r in
    select f.id, f.numero, f.estado, f.total, f.monto_pagado, f.proveedor_id as entidad_id
      from public.facturas_compra f
      join public.facturas_compra_tickets ft on ft.factura_id = f.id
     where ft.ticket_id = p_ticket_id
       and f.estado <> 'anulada'
       for update of f
  loop
    v_pagos := r.estado = 'pagada'
      or coalesce(r.monto_pagado, 0) > 0
      or exists (select 1 from public.pago_aplicaciones pa where pa.tipo = 'factura' and pa.item_id = r.id);

    if v_pagos then
      v_res := v_res || jsonb_build_object(
        'tipo', 'compra', 'facturaId', r.id, 'numero', r.numero, 'entidadId', r.entidad_id,
        'total', r.total, 'montoPagado', coalesce(r.monto_pagado, 0), 'estadoAnterior', r.estado,
        'accion', 'pagada', 'ticketsLiberados', 0);
    else
      select coalesce(array_agg(ticket_id), '{}') into v_tickets
        from public.facturas_compra_tickets where factura_id = r.id;

      delete from public.facturas_compra_tickets where factura_id = r.id;
      update public.tickets_pesaje set facturado = false
       where id = any(v_tickets) or ticket_principal_id = any(v_tickets);
      update public.facturas_compra
         set estado = 'anulada', anulada_at = now(), anulada_motivo = p_motivo, anulada_ticket_ids = v_tickets
       where id = r.id;

      v_res := v_res || jsonb_build_object(
        'tipo', 'compra', 'facturaId', r.id, 'numero', r.numero, 'entidadId', r.entidad_id,
        'total', r.total, 'montoPagado', 0, 'estadoAnterior', r.estado,
        'accion', 'anulada', 'ticketsLiberados', coalesce(array_length(v_tickets, 1), 0));
    end if;
  end loop;

  -- Ventas -------------------------------------------------------------------
  for r in
    select f.id, f.numero, f.estado, f.total, f.monto_pagado, f.cliente_id as entidad_id
      from public.facturas_venta f
      join public.facturas_venta_tickets ft on ft.factura_id = f.id
     where ft.ticket_id = p_ticket_id
       and f.estado <> 'anulada'
       for update of f
  loop
    v_pagos := r.estado = 'pagada'
      or coalesce(r.monto_pagado, 0) > 0
      or exists (select 1 from public.pago_aplicaciones pa where pa.tipo = 'factura' and pa.item_id = r.id);

    if v_pagos then
      v_res := v_res || jsonb_build_object(
        'tipo', 'venta', 'facturaId', r.id, 'numero', r.numero, 'entidadId', r.entidad_id,
        'total', r.total, 'montoPagado', coalesce(r.monto_pagado, 0), 'estadoAnterior', r.estado,
        'accion', 'pagada', 'ticketsLiberados', 0);
    else
      select coalesce(array_agg(ticket_id), '{}') into v_tickets
        from public.facturas_venta_tickets where factura_id = r.id;

      delete from public.facturas_venta_tickets where factura_id = r.id;
      update public.tickets_pesaje set facturado = false
       where id = any(v_tickets) or ticket_principal_id = any(v_tickets);
      update public.facturas_venta
         set estado = 'anulada', anulada_at = now(), anulada_motivo = p_motivo, anulada_ticket_ids = v_tickets
       where id = r.id;

      v_res := v_res || jsonb_build_object(
        'tipo', 'venta', 'facturaId', r.id, 'numero', r.numero, 'entidadId', r.entidad_id,
        'total', r.total, 'montoPagado', 0, 'estadoAnterior', r.estado,
        'accion', 'anulada', 'ticketsLiberados', coalesce(array_length(v_tickets, 1), 0));
    end if;
  end loop;

  return v_res;
end;
$$;

-- 5. Edición del ticket + tratamiento de sus facturas en una sola transacción --
-- Mismos parámetros que editar_ticket_pesaje + p_motivo_anulacion. Devuelve
-- { facturas: [...] } con el resultado de anular_facturas_de_ticket.
create or replace function public.editar_ticket_con_factura(
  p_ticket_id          uuid,
  p_materiales         jsonb,
  p_peso_global        numeric  default null,
  p_observaciones      text     default null,
  p_devolucion         numeric  default null,
  p_fotos_devolucion   text[]   default null,
  p_vehiculo           text     default null,
  p_fecha              date     default null,
  p_pesajes_globales   jsonb    default null,
  p_permitir_facturado boolean  default false,
  p_motivo_anulacion   text     default null
)
returns jsonb
language plpgsql
as $$
begin
  perform public.editar_ticket_pesaje(
    p_ticket_id          => p_ticket_id,
    p_materiales         => p_materiales,
    p_peso_global        => p_peso_global,
    p_observaciones      => p_observaciones,
    p_devolucion         => p_devolucion,
    p_fotos_devolucion   => p_fotos_devolucion,
    p_vehiculo           => p_vehiculo,
    p_fecha              => p_fecha,
    p_pesajes_globales   => p_pesajes_globales,
    p_permitir_facturado => p_permitir_facturado
  );
  return jsonb_build_object('facturas', public.anular_facturas_de_ticket(p_ticket_id, p_motivo_anulacion));
end;
$$;

commit;
