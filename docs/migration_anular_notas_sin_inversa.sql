-- Anulación de notas de crédito/débito (proveedor y cliente) SIN crear nota inversa.
--
-- PROBLEMA: anular_nota_ajuste_proveedor / anular_nota_ajuste_cliente insertaban una
-- nota contraria (crédito -> débito y viceversa) por el mismo monto y marcaban la
-- original como anulada. El resultado: dos documentos nuevos en el estado de cuenta
-- y una nota "fantasma" que el usuario no pidió.
--
-- NUEVO COMPORTAMIENTO:
--   * Anular = marcar la nota (anulada = true, anulada_at, anulada_por, anulada_motivo).
--     No se inserta nada. La nota queda en historial.
--   * El estado de cuenta (backend, estado-cuenta-service.ts) ya no suma/resta las
--     notas anuladas; se listan con etiqueta "Anulada".
--   * No se puede anular una nota ya anulada.
--   * REGLA SEGURA para notas aplicadas en un pago/cobro (pagada = true): se BLOQUEA la
--     anulación con un mensaje que indica el pago/cobro (no se libera la aplicación
--     automáticamente: reversar un pago es una operación contable que debe hacerse
--     de forma explícita, no como efecto colateral de anular una nota).
--   * Las funciones de pago (registrar_pago_proveedor_multi_banca, registrar_cobro_cliente_
--     multi_banca, registrar_pago_proveedor_multiple) YA exigen anulada = false al aplicar
--     una nota; no se tocan.
--   * Una nota nueva no puede crearse sobre una factura anulada (trigger de defensa;
--     el backend también lo valida con mensaje claro).
--   * REGLA SEGURA para facturas con notas vigentes: anular_facturas_de_ticket NO anula
--     automáticamente una factura que tenga notas vigentes (anulada = false) ligadas
--     (igual que ya hace con las facturas con pagos): la deja intacta y devuelve
--     accion = 'con_notas' para que el backend avise al usuario, que debe anular
--     primero las notas y luego corregir la factura. Así nunca queda una nota vigente
--     apuntando a una factura anulada.
--
-- Los datos existentes NO se borran. La nota inversa errónea que ya existe en producción
-- (cliente, NCV-0001 inversa de NDV-0001) se corrige con un archivo aparte:
-- docs/correccion_notas_inversas_erroneas.sql (a aprobar por separado).
--
-- Toda función nueva/reemplazada lleva REVOKE EXECUTE ... FROM public, anon, authenticated
-- (el backend usa service_role). Nota: las dos funciones de anulación estaban expuestas a
-- public/anon/authenticated; este script lo cierra.
--
-- IDEMPOTENTE. Transaccional. El tipo de retorno de las funciones no cambia (uuid; ahora
-- devuelve el id de la nota anulada, no el de una inversa), por lo que no hace falta DROP.
--
-- ORDEN DE DESPLIEGUE: aplicar esta migración ANTES de desplegar el backend nuevo (el
-- detalle de nota lee las columnas anulada_at/anulada_por/anulada_motivo).
--
-- ROLLBACK (restaura el comportamiento anterior; las columnas nuevas se pueden dejar):
--   begin;
--   drop trigger if exists trg_nota_proveedor_factura_no_anulada on public.notas_ajuste_proveedor;
--   drop trigger if exists trg_nota_cliente_factura_no_anulada on public.notas_ajuste_cliente;
--   drop function if exists public.validar_nota_proveedor_factura_no_anulada();
--   drop function if exists public.validar_nota_cliente_factura_no_anulada();
--   -- Volver a ejecutar docs/sql/functions/anular_nota_ajuste_proveedor.sql y
--   -- docs/sql/functions/anular_nota_ajuste_cliente.sql (versión con nota inversa).
--   -- Volver a ejecutar la definición anterior de anular_facturas_de_ticket
--   -- (docs/sql/functions/anular_facturas_de_ticket.sql en git antes de este cambio).
--   -- Opcional: alter table ... drop column anulada_at, anulada_por, anulada_motivo;
--   commit;

begin;

-- 1) Columnas de auditoría de la anulación -------------------------------------------
alter table public.notas_ajuste_proveedor
  add column if not exists anulada_at     timestamptz,
  add column if not exists anulada_por    uuid references public.users(id),
  add column if not exists anulada_motivo text;

alter table public.notas_ajuste_cliente
  add column if not exists anulada_at     timestamptz,
  add column if not exists anulada_por    uuid references public.users(id),
  add column if not exists anulada_motivo text;

-- Backfill de lo ya anulado (flujo anterior): toma fecha/usuario/motivo de la nota inversa.
update public.notas_ajuste_proveedor o
   set anulada_at     = coalesce(i.created_at, o.created_at),
       anulada_por    = i.registrado_por,
       anulada_motivo = i.motivo
  from public.notas_ajuste_proveedor i
 where o.anulada
   and o.anulada_at is null
   and i.anula_nota_id = o.id;

update public.notas_ajuste_cliente o
   set anulada_at     = coalesce(i.created_at, o.created_at),
       anulada_por    = i.registrado_por,
       anulada_motivo = i.motivo
  from public.notas_ajuste_cliente i
 where o.anulada
   and o.anulada_at is null
   and i.anula_nota_id = o.id;

-- 2) anular_nota_ajuste_proveedor: marca, no inserta -----------------------------------
create or replace function public.anular_nota_ajuste_proveedor(
  p_nota_id uuid, p_motivo text, p_registrado_por uuid
) returns uuid
language plpgsql
as $function$
declare
  v_encontrada boolean;
  v_anulada    boolean;
  v_pagada     boolean;
  v_mov_id     uuid;
  v_mov_num    bigint;
  v_mov_sub    text;
  v_ref        text;
begin
  select true, anulada, pagada, movimiento_id
    into v_encontrada, v_anulada, v_pagada, v_mov_id
    from public.notas_ajuste_proveedor
   where id = p_nota_id
   for update;

  if v_encontrada is not true then
    raise exception 'Nota no encontrada.';
  end if;
  if v_anulada then
    raise exception 'Esta nota ya fue anulada.';
  end if;
  if v_pagada then
    select numero, subtipo into v_mov_num, v_mov_sub
      from public.movimientos where id = v_mov_id;
    v_ref := case
      when v_mov_num is not null then ' (PG-' || lpad(v_mov_num::text, 4, '0') || ')'
      else ''
    end;
    raise exception 'Esta nota ya fue aplicada en un pago%: no se puede anular sin reversar antes ese pago.', v_ref;
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'El motivo de la anulación es obligatorio.';
  end if;

  update public.notas_ajuste_proveedor
     set anulada = true,
         anulada_at = now(),
         anulada_por = p_registrado_por,
         anulada_motivo = btrim(p_motivo)
   where id = p_nota_id;

  return p_nota_id;
end;
$function$;

-- 3) anular_nota_ajuste_cliente --------------------------------------------------------
create or replace function public.anular_nota_ajuste_cliente(
  p_nota_id uuid, p_motivo text, p_registrado_por uuid
) returns uuid
language plpgsql
as $function$
declare
  v_encontrada boolean;
  v_anulada    boolean;
  v_pagada     boolean;
  v_mov_id     uuid;
  v_mov_num    bigint;
  v_ref        text;
begin
  select true, anulada, pagada, movimiento_id
    into v_encontrada, v_anulada, v_pagada, v_mov_id
    from public.notas_ajuste_cliente
   where id = p_nota_id
   for update;

  if v_encontrada is not true then
    raise exception 'Nota no encontrada.';
  end if;
  if v_anulada then
    raise exception 'Esta nota ya fue anulada.';
  end if;
  if v_pagada then
    select numero into v_mov_num from public.movimientos where id = v_mov_id;
    v_ref := case
      when v_mov_num is not null then ' (CB-' || lpad(v_mov_num::text, 4, '0') || ')'
      else ''
    end;
    raise exception 'Esta nota ya fue aplicada en un cobro%: no se puede anular sin reversar antes ese cobro.', v_ref;
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'El motivo de la anulación es obligatorio.';
  end if;

  update public.notas_ajuste_cliente
     set anulada = true,
         anulada_at = now(),
         anulada_por = p_registrado_por,
         anulada_motivo = btrim(p_motivo)
   where id = p_nota_id;

  return p_nota_id;
end;
$function$;

revoke execute on function public.anular_nota_ajuste_proveedor(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.anular_nota_ajuste_cliente(uuid, text, uuid)   from public, anon, authenticated;
grant  execute on function public.anular_nota_ajuste_proveedor(uuid, text, uuid) to service_role;
grant  execute on function public.anular_nota_ajuste_cliente(uuid, text, uuid)   to service_role;

-- 4) No crear notas sobre facturas anuladas (defensa en BD) -----------------------------
create or replace function public.validar_nota_proveedor_factura_no_anulada()
returns trigger
language plpgsql
as $function$
begin
  if new.factura_id is not null and exists (
    select 1 from public.facturas_compra f where f.id = new.factura_id and f.estado = 'anulada'
  ) then
    raise exception 'No se puede crear una nota sobre una factura anulada.';
  end if;
  return new;
end;
$function$;

create or replace function public.validar_nota_cliente_factura_no_anulada()
returns trigger
language plpgsql
as $function$
begin
  if new.factura_id is not null and exists (
    select 1 from public.facturas_venta f where f.id = new.factura_id and f.estado = 'anulada'
  ) then
    raise exception 'No se puede crear una nota sobre una factura anulada.';
  end if;
  return new;
end;
$function$;

revoke execute on function public.validar_nota_proveedor_factura_no_anulada() from public, anon, authenticated;
revoke execute on function public.validar_nota_cliente_factura_no_anulada()   from public, anon, authenticated;

drop trigger if exists trg_nota_proveedor_factura_no_anulada on public.notas_ajuste_proveedor;
create trigger trg_nota_proveedor_factura_no_anulada
  before insert on public.notas_ajuste_proveedor
  for each row execute function public.validar_nota_proveedor_factura_no_anulada();

drop trigger if exists trg_nota_cliente_factura_no_anulada on public.notas_ajuste_cliente;
create trigger trg_nota_cliente_factura_no_anulada
  before insert on public.notas_ajuste_cliente
  for each row execute function public.validar_nota_cliente_factura_no_anulada();

-- 5) anular_facturas_de_ticket: no anular facturas con notas vigentes ------------------
create or replace function public.anular_facturas_de_ticket(p_ticket_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
as $function$
declare
  r         record;
  v_res     jsonb := '[]'::jsonb;
  v_tickets uuid[];
  v_pagos   boolean;
  v_notas   int;
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

    select count(*) into v_notas
      from public.notas_ajuste_proveedor n
     where n.factura_id = r.id and n.anulada = false;

    if v_pagos then
      v_res := v_res || jsonb_build_object(
        'tipo', 'compra', 'facturaId', r.id, 'numero', r.numero, 'entidadId', r.entidad_id,
        'total', r.total, 'montoPagado', coalesce(r.monto_pagado, 0), 'estadoAnterior', r.estado,
        'accion', 'pagada', 'ticketsLiberados', 0, 'notasVigentes', v_notas);
    elsif v_notas > 0 then
      v_res := v_res || jsonb_build_object(
        'tipo', 'compra', 'facturaId', r.id, 'numero', r.numero, 'entidadId', r.entidad_id,
        'total', r.total, 'montoPagado', coalesce(r.monto_pagado, 0), 'estadoAnterior', r.estado,
        'accion', 'con_notas', 'ticketsLiberados', 0, 'notasVigentes', v_notas);
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
        'accion', 'anulada', 'ticketsLiberados', coalesce(array_length(v_tickets, 1), 0),
        'notasVigentes', 0);
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

    select count(*) into v_notas
      from public.notas_ajuste_cliente n
     where n.factura_id = r.id and n.anulada = false;

    if v_pagos then
      v_res := v_res || jsonb_build_object(
        'tipo', 'venta', 'facturaId', r.id, 'numero', r.numero, 'entidadId', r.entidad_id,
        'total', r.total, 'montoPagado', coalesce(r.monto_pagado, 0), 'estadoAnterior', r.estado,
        'accion', 'pagada', 'ticketsLiberados', 0, 'notasVigentes', v_notas);
    elsif v_notas > 0 then
      v_res := v_res || jsonb_build_object(
        'tipo', 'venta', 'facturaId', r.id, 'numero', r.numero, 'entidadId', r.entidad_id,
        'total', r.total, 'montoPagado', coalesce(r.monto_pagado, 0), 'estadoAnterior', r.estado,
        'accion', 'con_notas', 'ticketsLiberados', 0, 'notasVigentes', v_notas);
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
        'accion', 'anulada', 'ticketsLiberados', coalesce(array_length(v_tickets, 1), 0),
        'notasVigentes', 0);
    end if;
  end loop;

  return v_res;
end;
$function$;

revoke execute on function public.anular_facturas_de_ticket(uuid, text) from public, anon, authenticated;
grant  execute on function public.anular_facturas_de_ticket(uuid, text) to service_role;

commit;
