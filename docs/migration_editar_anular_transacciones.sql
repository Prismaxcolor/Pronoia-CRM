-- =====================================================================
-- Editar y anular transacciones (pagos, cobros, cruces y movimientos de banca)
--
-- Hasta hoy una transaccion solo se podia crear. Este script agrega, en una
-- transaccion SQL atomica cada vez, las RPC para:
--   * ANULAR un pago / cobro / cruce (por grupo_id) y un movimiento de banca
--     manual: revierte el saldo de las bancas, factura.monto_pagado / estado,
--     notas aplicadas (vuelven a quedar libres) y las aplicaciones de adelantos.
--     La fila NUNCA se borra: queda marcada anulado=true con motivo, quien y
--     cuando. No se anula dos veces ni si dejaria un estado incoherente (un
--     adelanto ya usado en otra operacion, una factura con pagos negativos, una
--     banca que quedaria en negativo...): se rechaza con un mensaje claro.
--   * EDITAR campos no contables (fecha, descripcion, referencia, comprobantes) y
--     contables (bancas, montos, monedas, items aplicados) de un pago/cobro con
--     dinero y de un movimiento manual. La edicion contable revierte el efecto
--     completo y lo reaplica con los valores nuevos en la misma transaccion,
--     conservando grupo_id, correlativos, fecha de registro y autor.
--   * Una vista pagos_grupo(id) para que el sistema de llaves de edicion pueda
--     comprobar que un grupo de pago/cobro existe (entidades 'pago' y 'cobro').
--
-- Modelo contable (docs/migration_cruce_pagos*.sql):
--   * Una operacion = un grupo (movimientos.grupo_id, o el id del movimiento si es
--     legacy) con filas 'pago'/'cobro' y 'adelanto'/'anticipo' (una por banca) mas
--     pago_aplicaciones (factura / nota / adelanto) -- o una fila en cruces si no
--     movio dinero.
--   * El saldo de la banca solo lo ajusta el trigger de INSERT: anular y editar
--     replican ese calculo a mano (_aplicar_efecto_saldo).
--   * Las filas anuladas y sus aplicaciones (pago_aplicaciones.anulada) dejan de
--     contar en: adelantos_disponibles, aplicar_item_cruce, reconciliar_saldo_banca
--     (aqui) y en el backend (saldos, estado de cuenta, portal, asistente).
--
-- ORDEN DE DESPLIEGUE: aplicar este script ANTES de desplegar el backend (el backend
-- filtra por las columnas nuevas).
-- Idempotente (IF NOT EXISTS / CREATE OR REPLACE). No inserta datos de negocio.
-- ROLLBACK: docs/migration_editar_anular_transacciones_ROLLBACK.sql
-- Hacer backup antes de aplicar.
-- =====================================================================
begin;

-- 1. Columnas de anulacion ----------------------------------------------
alter table public.movimientos
  add column if not exists anulado        boolean     not null default false,
  add column if not exists anulado_at     timestamptz,
  add column if not exists anulado_por    uuid references public.users(id),
  add column if not exists anulado_motivo text;

alter table public.cruces
  add column if not exists anulado        boolean     not null default false,
  add column if not exists anulado_at     timestamptz,
  add column if not exists anulado_por    uuid references public.users(id),
  add column if not exists anulado_motivo text;

alter table public.pago_aplicaciones
  add column if not exists anulada    boolean     not null default false,
  add column if not exists anulada_at timestamptz;

alter table public.movimientos drop constraint if exists movimientos_anulado_coherente;
alter table public.movimientos add constraint movimientos_anulado_coherente
  check (not anulado or (anulado_at is not null and anulado_motivo is not null));
alter table public.cruces drop constraint if exists cruces_anulado_coherente;
alter table public.cruces add constraint cruces_anulado_coherente
  check (not anulado or (anulado_at is not null and anulado_motivo is not null));

create index if not exists idx_movimientos_grupo_id on public.movimientos (grupo_id) where grupo_id is not null;
create index if not exists idx_pago_aplicaciones_grupo_id on public.pago_aplicaciones (grupo_id);

-- 2. Vista de grupos de pago/cobro (para las llaves de edicion) -----------
create or replace view public.pagos_grupo as
  select coalesce(m.grupo_id, m.id) as id
    from public.movimientos m
   where m.subtipo is not null
  union
  select c.grupo_id from public.cruces c;
revoke all on public.pagos_grupo from public, anon, authenticated;
grant select on public.pagos_grupo to service_role;

-- 3. Funciones existentes: ignorar lo anulado ------------------------------
-- 3a. Saldo de banca recalculado desde los movimientos vigentes.
create or replace function public.reconciliar_saldo_banca(p_banca_id uuid)
returns numeric
language plpgsql
as $function$
declare
  v_saldo numeric := 0;
begin
  select coalesce(sum(case
           when tipo = 'ingreso'       and banca_origen_id  = p_banca_id then  monto
           when tipo = 'egreso'        and banca_origen_id  = p_banca_id then -monto
           when tipo = 'transferencia' and banca_origen_id  = p_banca_id then -monto
           when tipo = 'transferencia' and banca_destino_id = p_banca_id then  coalesce(monto_destino, monto)
           else 0
         end), 0)
    into v_saldo
    from public.movimientos
   where not anulado;

  update public.bancas set saldo = v_saldo where id = p_banca_id;
  return v_saldo;
end;
$function$;

-- 3b. Adelantos / anticipos con saldo sin aplicar (sin anulados).
create or replace function public.adelantos_disponibles(p_es_proveedor boolean, p_entidad_id uuid)
returns table (adelanto_id uuid, numero bigint, fecha date, descripcion text,
               total numeric, aplicado numeric, disponible numeric)
language sql
stable
set search_path = public
as $$
  with ad as (
    select coalesce(m.grupo_id, m.id)                    as k,
           min(m.numero)                                 as numero,
           min(m.fecha)                                  as fecha,
           min(m.descripcion)                            as descripcion,
           round(sum(coalesce(m.monto_usd, m.monto)), 2) as total
      from public.movimientos m
     where m.subtipo = case when p_es_proveedor then 'adelanto' else 'anticipo' end
       and not m.anulado
       and ((p_es_proveedor and m.proveedor_id = p_entidad_id)
         or (not p_es_proveedor and m.cliente_id = p_entidad_id))
     group by coalesce(m.grupo_id, m.id)
  )
  select ad.k, ad.numero, ad.fecha, ad.descripcion, ad.total,
         coalesce(ap.s, 0), round(ad.total - coalesce(ap.s, 0), 2)
    from ad
    left join lateral (
      select round(sum(a.monto_usd), 2) as s
        from public.pago_aplicaciones a
       where a.tipo = 'adelanto' and a.item_id = ad.k and not a.anulada
    ) ap on true
   order by ad.fecha, ad.numero;
$$;

-- 3c. Aplicacion de un item: el adelanto disponible ignora lo anulado.
create or replace function public.aplicar_item_cruce(p_es_proveedor boolean, p_entidad_id uuid, p_grupo_id uuid, p_tipo text, p_id uuid, p_monto numeric, p_movimiento_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_total     numeric;
  v_pagado    numeric;
  v_estado    text;
  v_saldo     numeric;
  v_nuevo     numeric;
  v_aplicado  numeric;
  v_nota_tipo text;
  v_nota_mto  numeric;
  v_anulada   boolean;
  v_pagada    boolean;
  v_nota_ok   boolean;
  v_etiqueta  text := case when p_es_proveedor then 'proveedor' else 'cliente' end;
begin
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto de cada item debe ser mayor a 0.';
  end if;

  if p_tipo = 'factura' then
    if p_es_proveedor then
      select total, monto_pagado, estado into v_total, v_pagado, v_estado
        from public.facturas_compra where id = p_id and proveedor_id = p_entidad_id for update;
    else
      select total, monto_pagado, estado into v_total, v_pagado, v_estado
        from public.facturas_venta where id = p_id and cliente_id = p_entidad_id for update;
    end if;

    if v_total is null then
      raise exception 'Factura % no encontrada para este %.', p_id, v_etiqueta;
    end if;
    if v_estado in ('anulada', 'borrador') then
      raise exception 'La factura % esta % y no se puede pagar ni cruzar.', p_id, v_estado;
    end if;

    v_saldo := round(v_total - coalesce(v_pagado, 0), 2);
    if p_monto > v_saldo + 0.01 then
      raise exception 'El monto aplicado a la factura % (%) supera su saldo pendiente (%).', p_id, p_monto, v_saldo;
    end if;

    v_nuevo := round(coalesce(v_pagado, 0) + p_monto, 2);
    if p_es_proveedor then
      update public.facturas_compra
         set monto_pagado = v_nuevo,
             estado = case when v_nuevo >= v_total - 0.01 then 'pagada' else estado end
       where id = p_id;
    else
      update public.facturas_venta
         set monto_pagado = v_nuevo,
             estado = case when v_nuevo >= v_total - 0.01 then 'pagada' else estado end
       where id = p_id;
    end if;

  elsif p_tipo in ('nota_debito', 'nota_credito') then
    -- Las notas se consumen completas (pagada = true), nunca en parte.
    if p_es_proveedor then
      select tipo, monto, anulada, pagada into v_nota_tipo, v_nota_mto, v_anulada, v_pagada
        from public.notas_ajuste_proveedor where id = p_id and proveedor_id = p_entidad_id for update;
    else
      select tipo, monto, anulada, pagada into v_nota_tipo, v_nota_mto, v_anulada, v_pagada
        from public.notas_ajuste_cliente where id = p_id and cliente_id = p_entidad_id for update;
    end if;

    if v_nota_tipo is null then
      raise exception 'Nota % no encontrada para este %.', p_id, v_etiqueta;
    end if;
    v_nota_ok := (p_tipo = 'nota_debito' and v_nota_tipo = 'debito')
              or (p_tipo = 'nota_credito' and v_nota_tipo = 'credito');
    if not v_nota_ok then
      raise exception 'La nota % no es de tipo %.', p_id, p_tipo;
    end if;
    if v_anulada then
      raise exception 'La nota % esta anulada y no se puede usar.', p_id;
    end if;
    if v_pagada then
      raise exception 'La nota % ya fue aplicada.', p_id;
    end if;
    if abs(round(p_monto, 2) - round(v_nota_mto, 2)) > 0.01 then
      raise exception 'La nota % se aplica completa (%), no por (%).', p_id, v_nota_mto, p_monto;
    end if;

    if p_es_proveedor then
      update public.notas_ajuste_proveedor set pagada = true, movimiento_id = p_movimiento_id where id = p_id;
    else
      update public.notas_ajuste_cliente set pagada = true, movimiento_id = p_movimiento_id where id = p_id;
    end if;

  elsif p_tipo = 'adelanto' then
    -- p_id = grupo_id del adelanto (o id del movimiento si es legacy sin grupo).
    select round(sum(coalesce(monto_usd, monto)), 2) into v_total
      from public.movimientos
     where (grupo_id = p_id or (grupo_id is null and id = p_id))
       and not anulado
       and subtipo = case when p_es_proveedor then 'adelanto' else 'anticipo' end
       and ((p_es_proveedor and proveedor_id = p_entidad_id)
         or (not p_es_proveedor and cliente_id = p_entidad_id));

    if v_total is null then
      raise exception 'Adelanto % no encontrado para este %.', p_id, v_etiqueta;
    end if;

    select coalesce(sum(monto_usd), 0) into v_aplicado
      from public.pago_aplicaciones where tipo = 'adelanto' and item_id = p_id and not anulada;

    if p_monto > round(v_total - v_aplicado, 2) + 0.01 then
      raise exception 'El adelanto % solo tiene % disponible (se intento aplicar %).',
        p_id, round(v_total - v_aplicado, 2), p_monto;
    end if;

  else
    raise exception 'Tipo de item desconocido: %', p_tipo;
  end if;

  insert into public.pago_aplicaciones (grupo_id, tipo, item_id, monto_usd)
  values (p_grupo_id, p_tipo, p_id, round(p_monto, 2));
end;
$function$;

-- =====================================================================
-- 4. Auxiliares internos (solo los llaman las RPC de abajo)
-- =====================================================================

-- Aplica (p_signo = 1) o revierte (p_signo = -1) el efecto de un movimiento
-- sobre el saldo de las bancas. Espejo EXACTO de aplicar_movimiento_a_saldo()
-- (el trigger solo corre en INSERT; anular/editar necesitan el mismo calculo).
create or replace function public._aplicar_efecto_saldo(
  p_tipo text, p_origen uuid, p_destino uuid, p_monto numeric, p_monto_destino numeric, p_signo int)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_tipo = 'ingreso' then
    update public.bancas set saldo = saldo + p_signo * p_monto where id = p_origen;
  elsif p_tipo = 'egreso' then
    update public.bancas set saldo = saldo - p_signo * p_monto where id = p_origen;
  elsif p_tipo = 'transferencia' then
    update public.bancas set saldo = saldo - p_signo * p_monto where id = p_origen;
    update public.bancas set saldo = saldo + p_signo * coalesce(p_monto_destino, p_monto) where id = p_destino;
  end if;
end;
$$;

-- Foto de los saldos de las bancas indicadas (jsonb {banca_id: saldo}).
create or replace function public._snapshot_saldos(p_ids uuid[])
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(id::text, saldo), '{}'::jsonb)
    from public.bancas where id = any(p_ids);
$$;

-- Rechaza si alguna banca quedo con saldo negativo Y peor que antes de la
-- operacion (anular un cobro cuyo dinero ya se gasto, o editar un egreso al
-- alza sin fondos). Una banca que ya estaba en negativo no bloquea nada que no
-- la empeore. Misma regla que "Saldo insuficiente" de registrar_pago_proveedor.
create or replace function public._verificar_saldos(p_antes jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  r record;
begin
  for r in select b.nombre, b.saldo, (p_antes->>(b.id::text))::numeric as antes
             from public.bancas b where p_antes ? (b.id::text)
  loop
    if r.saldo < -0.01 and r.saldo < r.antes - 0.005 then
      raise exception 'Saldo insuficiente en la banca %: la operacion la dejaria en % (antes: %). Mueve fondos a esa banca primero.',
        r.nombre, round(r.saldo, 2), round(r.antes, 2);
    end if;
  end loop;
end;
$$;

-- Resuelve un grupo de pago/cobro: a quien pertenece, si movio dinero y si
-- ya esta anulado. El grupo es coalesce(grupo_id, id) de sus movimientos, o el
-- grupo_id de un cruce sin dinero. Un movimiento manual (sin subtipo) NO es un
-- grupo: se gestiona con las RPC de movimiento de banca.
create or replace function public._grupo_pago_contexto(p_grupo uuid)
returns table (es_proveedor boolean, entidad_id uuid, hay_dinero boolean, anulado boolean)
language plpgsql
stable
set search_path = public
as $$
declare
  v_filas int; v_vivas int; v_manuales int;
  v_prov uuid; v_cli uuid; v_cruce_anulado boolean;
begin
  select count(*), count(*) filter (where not m.anulado), count(*) filter (where m.subtipo is null),
         max(m.proveedor_id::text)::uuid, max(m.cliente_id::text)::uuid
    into v_filas, v_vivas, v_manuales, v_prov, v_cli
    from public.movimientos m
   where m.grupo_id = p_grupo or (m.grupo_id is null and m.id = p_grupo);

  if v_filas > 0 then
    if v_manuales > 0 then
      raise exception 'Este es un movimiento de banca manual, no un pago o cobro: gestionalo desde Cochinito.';
    end if;
    if v_prov is null and v_cli is null then
      raise exception 'El pago o cobro no tiene proveedor ni cliente asociado.';
    end if;
    return query select (v_prov is not null), coalesce(v_prov, v_cli), true, (v_vivas = 0);
    return;
  end if;

  select c.proveedor_id, c.cliente_id, c.anulado into v_prov, v_cli, v_cruce_anulado
    from public.cruces c where c.grupo_id = p_grupo;
  if not found then
    raise exception 'Pago o cobro no encontrado.';
  end if;
  return query select (v_prov is not null), coalesce(v_prov, v_cli), false, v_cruce_anulado;
end;
$$;

-- Revierte en facturas y notas lo que aplico el grupo (NO toca bancas ni marca
-- nada): factura.monto_pagado -= monto y estado pagada -> emitida si deja de
-- estar saldada; nota pagada -> libre de nuevo. Un adelanto usado como item no
-- necesita accion (su disponible se calcula sin las aplicaciones anuladas).
-- Rechaza si el resultado seria incoherente (factura con pagos negativos).
create or replace function public._revertir_aplicaciones_grupo(p_es_proveedor boolean, p_grupo uuid)
returns int
language plpgsql
set search_path = public
as $$
declare
  ap record;
  v_total numeric; v_pagado numeric; v_estado text; v_nuevo numeric; v_filas int; v_n int := 0;
begin
  for ap in
    select a.tipo, a.item_id, a.monto_usd
      from public.pago_aplicaciones a
     where a.grupo_id = p_grupo and not a.anulada
     order by a.tipo, a.item_id
  loop
    v_n := v_n + 1;
    if ap.tipo = 'factura' then
      if p_es_proveedor then
        select total, monto_pagado, estado into v_total, v_pagado, v_estado
          from public.facturas_compra where id = ap.item_id for update;
      else
        select total, monto_pagado, estado into v_total, v_pagado, v_estado
          from public.facturas_venta where id = ap.item_id for update;
      end if;
      if v_total is null then
        raise exception 'La factura aplicada (%) ya no existe: no se puede revertir.', ap.item_id;
      end if;
      v_nuevo := round(coalesce(v_pagado, 0) - ap.monto_usd, 2);
      if v_nuevo < -0.01 then
        raise exception 'No se puede revertir: la factura % quedaria con pagos negativos (pagado %, a revertir %). Revisa sus otros pagos.',
          ap.item_id, coalesce(v_pagado, 0), ap.monto_usd;
      end if;
      v_nuevo := greatest(v_nuevo, 0);
      -- Una factura anulada no cuenta en el saldo y un trigger impide tocarla:
      -- se deja como esta (la aplicacion igual queda revertida/anulada).
      if v_estado <> 'anulada' then
        if p_es_proveedor then
          update public.facturas_compra
             set monto_pagado = v_nuevo,
                 estado = case when estado = 'pagada' and v_nuevo < total - 0.01 then 'emitida' else estado end
           where id = ap.item_id;
        else
          update public.facturas_venta
             set monto_pagado = v_nuevo,
                 estado = case when estado = 'pagada' and v_nuevo < total - 0.01 then 'emitida' else estado end
           where id = ap.item_id;
        end if;
      end if;

    elsif ap.tipo in ('nota_debito', 'nota_credito') then
      if p_es_proveedor then
        update public.notas_ajuste_proveedor set pagada = false, movimiento_id = null
         where id = ap.item_id and pagada = true;
      else
        update public.notas_ajuste_cliente set pagada = false, movimiento_id = null
         where id = ap.item_id and pagada = true;
      end if;
      get diagnostics v_filas = row_count;
      if v_filas = 0 then
        raise exception 'La nota % ya no figura como aplicada: no se puede revertir.', ap.item_id;
      end if;
    end if;
  end loop;
  return v_n;
end;
$$;

-- Revierte en las bancas el dinero de los movimientos vivos del grupo.
create or replace function public._revertir_saldos_grupo(p_grupo uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  m record;
begin
  for m in
    select tipo, banca_origen_id, banca_destino_id, monto, monto_destino
      from public.movimientos
     where (grupo_id = p_grupo or (grupo_id is null and id = p_grupo)) and not anulado
  loop
    perform public._aplicar_efecto_saldo(m.tipo, m.banca_origen_id, m.banca_destino_id, m.monto, m.monto_destino, -1);
  end loop;
end;
$$;

-- =====================================================================
-- 5. ANULAR pago / cobro / cruce (por grupo)
-- =====================================================================
create or replace function public.anular_pago_cobro(p_grupo_id uuid, p_motivo text, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_ctx     record;
  v_bancas  uuid[];
  v_ini     jsonb;
  v_n_mov   int := 0;
  v_n_apl   int := 0;
  v_total   numeric;
begin
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'El motivo de la anulacion es obligatorio.';
  end if;

  select * into v_ctx from public._grupo_pago_contexto(p_grupo_id);
  if v_ctx.anulado then
    raise exception 'Esta operacion ya fue anulada.';
  end if;

  -- Mismo orden de bloqueo que registrar_*: entidad -> bancas (por id) -> items.
  if v_ctx.es_proveedor then
    perform 1 from public.proveedores where id = v_ctx.entidad_id for update;
  else
    perform 1 from public.clientes where id = v_ctx.entidad_id for update;
  end if;

  select coalesce(array_agg(distinct banca_origen_id), '{}') into v_bancas
    from public.movimientos
   where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado;
  perform 1 from public.bancas where id = any(v_bancas) order by id for update;
  perform 1 from public.movimientos
   where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado for update;

  -- El adelanto/anticipo de esta operacion ya se uso para pagar otras facturas:
  -- anular dejaria esas facturas pagadas con un adelanto que ya no existe.
  if exists (select 1 from public.pago_aplicaciones a
              where a.tipo = 'adelanto' and a.item_id = p_grupo_id and not a.anulada and a.grupo_id <> p_grupo_id) then
    raise exception 'El adelanto/anticipo generado por esta operacion ya fue aplicado a facturas en otra operacion. Anula primero esa operacion y luego esta.';
  end if;

  -- Pago simple antiguo (sin detalle de facturas): no se sabe que factura revertir.
  if exists (select 1 from public.movimientos m
              where (m.grupo_id = p_grupo_id or (m.grupo_id is null and m.id = p_grupo_id))
                and not m.anulado and m.subtipo in ('pago', 'cobro'))
     and not exists (select 1 from public.pago_aplicaciones a where a.grupo_id = p_grupo_id and not a.anulada) then
    raise exception 'Este pago/cobro se registro con el formato antiguo, sin detalle de facturas, y no se puede revertir de forma segura. Consulta al administrador.';
  end if;

  v_ini := public._snapshot_saldos(v_bancas);
  v_n_apl := public._revertir_aplicaciones_grupo(v_ctx.es_proveedor, p_grupo_id);
  perform public._revertir_saldos_grupo(p_grupo_id);

  select coalesce(sum(coalesce(monto_usd, monto)), 0) into v_total
    from public.movimientos
   where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado;

  update public.movimientos
     set anulado = true, anulado_at = now(), anulado_por = p_usuario, anulado_motivo = btrim(p_motivo)
   where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado;
  get diagnostics v_n_mov = row_count;

  update public.cruces
     set anulado = true, anulado_at = now(), anulado_por = p_usuario, anulado_motivo = btrim(p_motivo)
   where grupo_id = p_grupo_id and not anulado;

  update public.pago_aplicaciones set anulada = true, anulada_at = now()
   where grupo_id = p_grupo_id and not anulada;

  perform public._verificar_saldos(v_ini);

  return jsonb_build_object(
    'grupoId', p_grupo_id, 'esProveedor', v_ctx.es_proveedor, 'entidadId', v_ctx.entidad_id,
    'movimientosAnulados', v_n_mov, 'aplicacionesRevertidas', v_n_apl, 'totalUsd', round(v_total, 2));
end;
$$;

-- =====================================================================
-- 6. EDITAR pago / cobro: campos NO contables (fecha, descripcion,
--    referencia, comprobantes). Valores finales; null = sin cambio.
-- =====================================================================
create or replace function public.editar_pago_cobro_campos(
  p_grupo_id uuid, p_descripcion text, p_referencia text, p_fecha date, p_comprobantes jsonb, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_ctx record;
  v_principal uuid;
  v_hay_pago boolean;
begin
  select * into v_ctx from public._grupo_pago_contexto(p_grupo_id);
  if v_ctx.anulado then
    raise exception 'Esta operacion esta anulada y no se puede editar.';
  end if;

  if not v_ctx.hay_dinero then
    update public.cruces
       set fecha = coalesce(p_fecha, fecha),
           descripcion = case when p_descripcion is null then descripcion else nullif(btrim(p_descripcion), '') end
     where grupo_id = p_grupo_id;
    return jsonb_build_object('grupoId', p_grupo_id);
  end if;

  perform 1 from public.movimientos
   where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado for update;

  if p_fecha is not null then
    update public.movimientos set fecha = p_fecha
     where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado;
  end if;

  if p_descripcion is not null then
    -- La descripcion vive en las filas de pago/cobro; si solo hay adelanto, en el adelanto.
    select exists (select 1 from public.movimientos
                    where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id))
                      and not anulado and subtipo in ('pago', 'cobro')) into v_hay_pago;
    update public.movimientos set descripcion = btrim(p_descripcion)
     where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado
       and (subtipo in ('pago', 'cobro') or not v_hay_pago);
  end if;

  if p_referencia is not null then
    update public.movimientos set referencia = nullif(btrim(p_referencia), '')
     where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado;
  end if;

  if p_comprobantes is not null then
    -- Los comprobantes viven en el movimiento principal (pago/cobro, o adelanto si no hubo pago).
    select id into v_principal from public.movimientos
     where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado
     order by (subtipo in ('pago', 'cobro')) desc, creado_en, id limit 1;
    update public.movimientos set comprobantes = '[]'::jsonb
     where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado;
    update public.movimientos set comprobantes = p_comprobantes where id = v_principal;
  end if;

  return jsonb_build_object('grupoId', p_grupo_id);
end;
$$;

-- =====================================================================
-- 7. EDITAR pago / cobro: parte CONTABLE (bancas, montos, monedas, items).
--    Revierte el efecto completo del grupo y lo reaplica con los valores
--    nuevos en UNA transaccion, conservando grupo_id, correlativos, fecha de
--    registro y autor. Solo pagos/cobros con dinero (un cruce puro no se
--    edita: se anula). Misma validacion que registrar_*_multi_banca.
-- =====================================================================
create or replace function public.editar_pago_cobro_contable(
  p_grupo_id uuid, p_bancas jsonb, p_monto_usd numeric, p_items jsonb,
  p_descripcion text, p_referencia text, p_fecha date, p_comprobantes jsonb, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_ctx          record;
  v_es           boolean;
  v_ent          uuid;
  v_item         jsonb;
  v_banca        jsonb;
  v_tipo         text;
  v_cargos       numeric := 0;
  v_creditos     numeric := 0;
  v_total_items  numeric;
  v_total_bancas numeric;
  v_adelanto     numeric;
  v_ids_bancas   uuid[];
  v_ini          jsonb;
  v_nombre       text;
  v_archivada    boolean;
  v_mon_banca    text;
  v_num_pago     bigint;
  v_num_adel     bigint;
  v_creado       timestamptz;
  v_reg          uuid;
  v_comp         jsonb;
  v_restante     numeric;
  v_b_id         uuid;
  v_b_monto      numeric;
  v_b_usd        numeric;
  v_b_mon        text;
  v_b_ref        text;
  v_ap_pago      numeric;
  v_ap_adel      numeric;
  v_m_pago       numeric;
  v_m_adel       numeric;
  v_mov_id       uuid;
  v_pp           uuid;
  v_pa           uuid;
  v_ids          uuid[] := '{}';
  v_tipo_mov     text;
  v_sub_pago     text;
  v_sub_adel     text;
begin
  if p_items is null then p_items := '[]'::jsonb; end if;
  if p_bancas is null or jsonb_typeof(p_bancas) <> 'array' or jsonb_array_length(p_bancas) = 0 then
    raise exception 'Debe indicar al menos una banca. Para dejar la operacion sin movimiento de dinero, anulala.';
  end if;
  if p_monto_usd is null or p_monto_usd <= 0.01 then
    raise exception 'El total debe ser mayor a 0. Para dejar la operacion sin movimiento de dinero, anulala.';
  end if;
  if (select count(*) from jsonb_array_elements(p_bancas)) <>
     (select count(distinct (value->>'bancaId')) from jsonb_array_elements(p_bancas)) then
    raise exception 'No se puede repetir la misma banca.';
  end if;

  select * into v_ctx from public._grupo_pago_contexto(p_grupo_id);
  if v_ctx.anulado then
    raise exception 'Esta operacion esta anulada y no se puede editar.';
  end if;
  if not v_ctx.hay_dinero then
    raise exception 'Un cruce sin movimiento de dinero no admite cambios contables: anulalo y registralo de nuevo.';
  end if;
  v_es := v_ctx.es_proveedor;
  v_ent := v_ctx.entidad_id;
  v_tipo_mov := case when v_es then 'egreso' else 'ingreso' end;
  v_sub_pago := case when v_es then 'pago' else 'cobro' end;
  v_sub_adel := case when v_es then 'adelanto' else 'anticipo' end;

  -- Validacion del payload (igual que registrar_*_multi_banca).
  for v_item in select value from jsonb_array_elements(p_items) as elems(value)
  loop
    v_tipo := v_item->>'tipo';
    if (v_item->>'montoUsd')::numeric is null or (v_item->>'montoUsd')::numeric <= 0 then
      raise exception 'El monto de cada item debe ser mayor a 0.';
    end if;
    if v_tipo in ('factura', 'nota_debito') then
      v_cargos := v_cargos + round((v_item->>'montoUsd')::numeric, 2);
    elsif v_tipo in ('nota_credito', 'adelanto') then
      v_creditos := v_creditos + round((v_item->>'montoUsd')::numeric, 2);
    else
      raise exception 'Tipo de item desconocido: %', v_tipo;
    end if;
  end loop;
  if v_creditos > v_cargos + 0.01 then
    raise exception 'Los creditos aplicados (%) superan lo que se esta pagando/cobrando (%).', v_creditos, v_cargos;
  end if;
  v_total_items := round(v_cargos - v_creditos, 2);
  if abs(v_total_items) <= 0.01 then v_total_items := 0; end if;

  select coalesce(sum((value->>'montoUsd')::numeric), 0) into v_total_bancas
    from jsonb_array_elements(p_bancas) as elems(value);
  if abs(v_total_bancas - p_monto_usd) > 0.01 then
    raise exception 'La suma de las bancas (%) no coincide con el total (%).', v_total_bancas, p_monto_usd;
  end if;
  v_adelanto := round(p_monto_usd - v_total_items, 2);
  if v_adelanto < -0.01 then
    raise exception 'El total (%) es menor a la suma de lo seleccionado (%).', p_monto_usd, v_total_items;
  end if;
  if abs(v_adelanto) <= 0.01 then v_adelanto := 0; end if;

  -- Bloqueos: entidad -> bancas (viejas y nuevas, por id) -> movimientos.
  if v_es then
    perform 1 from public.proveedores where id = v_ent for update;
  else
    perform 1 from public.clientes where id = v_ent for update;
  end if;
  select coalesce(array_agg(distinct b), '{}') into v_ids_bancas from (
    select banca_origen_id as b from public.movimientos
     where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado
    union
    select (value->>'bancaId')::uuid from jsonb_array_elements(p_bancas) as elems(value)
  ) t;
  perform 1 from public.bancas where id = any(v_ids_bancas) order by id for update;
  perform 1 from public.movimientos
   where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado for update;

  for v_banca in select value from jsonb_array_elements(p_bancas) as elems(value)
  loop
    select nombre, archivada, moneda into v_nombre, v_archivada, v_mon_banca
      from public.bancas where id = (v_banca->>'bancaId')::uuid;
    if v_nombre is null then
      raise exception 'Banca % no encontrada.', v_banca->>'bancaId';
    end if;
    if v_archivada then
      raise exception 'La banca % esta archivada.', v_nombre;
    end if;
    if v_banca->>'moneda' is distinct from v_mon_banca then
      raise exception 'La moneda indicada (%) no coincide con la de la banca % (%).', v_banca->>'moneda', v_nombre, v_mon_banca;
    end if;
    if (v_banca->>'monto')::numeric is null or (v_banca->>'monto')::numeric <= 0
       or (v_banca->>'montoUsd')::numeric is null or (v_banca->>'montoUsd')::numeric <= 0 then
      raise exception 'Los montos de cada banca deben ser mayores a 0.';
    end if;
  end loop;

  -- El adelanto/anticipo de esta operacion ya se uso en otra: cambiar sus montos
  -- dejaria esas facturas pagadas con algo que cambio.
  if exists (select 1 from public.pago_aplicaciones a
              where a.tipo = 'adelanto' and a.item_id = p_grupo_id and not a.anulada and a.grupo_id <> p_grupo_id) then
    raise exception 'El adelanto/anticipo generado por esta operacion ya fue aplicado a facturas en otra operacion: no se puede cambiar su parte contable. Anula primero esa operacion.';
  end if;
  if exists (select 1 from public.movimientos m
              where (m.grupo_id = p_grupo_id or (m.grupo_id is null and m.id = p_grupo_id))
                and not m.anulado and m.subtipo in ('pago', 'cobro'))
     and not exists (select 1 from public.pago_aplicaciones a where a.grupo_id = p_grupo_id and not a.anulada) then
    raise exception 'Este pago/cobro se registro con el formato antiguo, sin detalle de facturas, y no admite cambios contables. Anulalo y registralo de nuevo.';
  end if;

  -- Lo que se conserva de la operacion original.
  select max(numero) filter (where subtipo = v_sub_pago), max(numero) filter (where subtipo = v_sub_adel),
         min(creado_en), (array_agg(registrado_por order by creado_en, id))[1]
    into v_num_pago, v_num_adel, v_creado, v_reg
    from public.movimientos
   where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado;
  if p_comprobantes is null then
    select comprobantes into v_comp from public.movimientos
     where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado
       and jsonb_array_length(comprobantes) > 0
     order by creado_en, id limit 1;
  else
    v_comp := p_comprobantes;
  end if;
  v_comp := coalesce(v_comp, '[]'::jsonb);

  v_ini := public._snapshot_saldos(v_ids_bancas);

  -- Revertir todo el efecto anterior...
  perform public._revertir_aplicaciones_grupo(v_es, p_grupo_id);
  perform public._revertir_saldos_grupo(p_grupo_id);
  delete from public.pago_aplicaciones where grupo_id = p_grupo_id and not anulada;
  delete from public.movimientos
   where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado;

  -- ...y reaplicarlo con los valores nuevos (items primero: si uno falla, todo se revierte).
  for v_item in select value from jsonb_array_elements(p_items) as elems(value)
  loop
    perform public.aplicar_item_cruce(v_es, v_ent, p_grupo_id,
      v_item->>'tipo', (v_item->>'id')::uuid, (v_item->>'montoUsd')::numeric, null::uuid);
  end loop;

  if v_total_items > 0 and v_num_pago is null then
    v_num_pago := nextval(case when v_es then 'public.movimientos_pago_numero_seq' else 'public.movimientos_cobro_numero_seq' end);
  end if;
  if v_adelanto > 0 and v_num_adel is null then
    v_num_adel := nextval(case when v_es then 'public.movimientos_adelanto_numero_seq' else 'public.movimientos_anticipo_cliente_numero_seq' end);
  end if;

  v_restante := v_total_items;
  for v_banca in select value from jsonb_array_elements(p_bancas) as elems(value)
  loop
    v_b_id := (v_banca->>'bancaId')::uuid;
    v_b_monto := (v_banca->>'monto')::numeric;
    v_b_usd := (v_banca->>'montoUsd')::numeric;
    v_b_mon := v_banca->>'moneda';
    v_b_ref := coalesce(nullif(v_banca->>'referencia', ''), nullif(p_referencia, ''));

    v_ap_pago := least(v_b_usd, v_restante);
    v_ap_adel := v_b_usd - v_ap_pago;
    v_restante := v_restante - v_ap_pago;
    v_m_pago := 0;

    if v_ap_pago > 0.01 then
      v_m_pago := round(v_b_monto * v_ap_pago / v_b_usd, 2);
      insert into public.movimientos
        (tipo, subtipo, numero, grupo_id, monto, moneda, monto_usd, descripcion,
         banca_origen_id, banca_destino_id, fecha, referencia, registrado_por, proveedor_id, cliente_id, creado_en)
      values
        (v_tipo_mov, v_sub_pago, v_num_pago, p_grupo_id, v_m_pago, v_b_mon, v_ap_pago,
         coalesce(p_descripcion, ''), v_b_id, null, p_fecha, v_b_ref, v_reg,
         case when v_es then v_ent end, case when v_es then null else v_ent end, v_creado)
      returning id into v_mov_id;
      v_ids := v_ids || v_mov_id;
      if v_pp is null then v_pp := v_mov_id; end if;
    end if;

    if v_ap_adel > 0.01 then
      v_m_adel := v_b_monto - v_m_pago;
      insert into public.movimientos
        (tipo, subtipo, numero, grupo_id, monto, moneda, monto_usd, descripcion,
         banca_origen_id, banca_destino_id, fecha, referencia, registrado_por, proveedor_id, cliente_id, creado_en)
      values
        (v_tipo_mov, v_sub_adel, v_num_adel, p_grupo_id, v_m_adel, v_b_mon, v_ap_adel,
         case when v_total_items > 0 then (case when v_es then 'Adelanto' else 'Anticipo' end) else coalesce(p_descripcion, '') end,
         v_b_id, null, p_fecha, v_b_ref, v_reg,
         case when v_es then v_ent end, case when v_es then null else v_ent end, v_creado)
      returning id into v_mov_id;
      v_ids := v_ids || v_mov_id;
      if v_pa is null then v_pa := v_mov_id; end if;
    end if;
  end loop;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Los montos por banca son demasiado pequenos para registrar movimientos.';
  end if;

  -- Enlaza las notas aplicadas al movimiento principal y deja los comprobantes ahi.
  if v_pp is not null then
    if v_es then
      update public.notas_ajuste_proveedor set movimiento_id = v_pp
       where proveedor_id = v_ent and id in (select (value->>'id')::uuid from jsonb_array_elements(p_items) as elems(value)
                                              where value->>'tipo' in ('nota_debito', 'nota_credito'));
    else
      update public.notas_ajuste_cliente set movimiento_id = v_pp
       where cliente_id = v_ent and id in (select (value->>'id')::uuid from jsonb_array_elements(p_items) as elems(value)
                                            where value->>'tipo' in ('nota_debito', 'nota_credito'));
    end if;
  end if;
  update public.movimientos set comprobantes = v_comp where id = coalesce(v_pp, v_pa);

  perform public._verificar_saldos(v_ini);

  return jsonb_build_object(
    'grupoId', p_grupo_id, 'movimientoIds', to_jsonb(v_ids),
    'numeroPago', v_num_pago, 'numeroAdelanto', v_num_adel);
end;
$$;

-- =====================================================================
-- 8. MOVIMIENTOS DE BANCA MANUALES (ingreso / egreso / transferencia)
--    Los movimientos que pertenecen a un pago/cobro (grupo_id o subtipo) se
--    gestionan por grupo: aqui se rechazan con un mensaje claro.
-- =====================================================================
create or replace function public._movimiento_manual_bloqueado(p_id uuid)
returns public.movimientos
language plpgsql
set search_path = public
as $$
declare
  m public.movimientos;
begin
  select * into m from public.movimientos where id = p_id for update;
  if not found then
    raise exception 'Movimiento no encontrado.';
  end if;
  if m.grupo_id is not null or m.subtipo is not null then
    raise exception 'Este movimiento forma parte de un pago/cobro (grupo %): edita o anula el pago/cobro completo desde el estado de cuenta.',
      coalesce(m.grupo_id, m.id);
  end if;
  if m.anulado then
    raise exception 'Este movimiento ya fue anulado.';
  end if;
  return m;
end;
$$;

create or replace function public.anular_movimiento_banca(p_id uuid, p_motivo text, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  m   public.movimientos;
  v_ini jsonb;
  v_ids uuid[];
begin
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'El motivo de la anulacion es obligatorio.';
  end if;
  m := public._movimiento_manual_bloqueado(p_id);
  v_ids := array_remove(array[m.banca_origen_id, m.banca_destino_id], null);
  perform 1 from public.bancas where id = any(v_ids) order by id for update;
  v_ini := public._snapshot_saldos(v_ids);

  perform public._aplicar_efecto_saldo(m.tipo, m.banca_origen_id, m.banca_destino_id, m.monto, m.monto_destino, -1);
  update public.movimientos
     set anulado = true, anulado_at = now(), anulado_por = p_usuario, anulado_motivo = btrim(p_motivo)
   where id = p_id;
  perform public._verificar_saldos(v_ini);

  return jsonb_build_object('movimientoId', p_id, 'tipo', m.tipo, 'monto', m.monto, 'moneda', m.moneda);
end;
$$;

create or replace function public.editar_movimiento_banca_campos(
  p_id uuid, p_descripcion text, p_referencia text, p_fecha date, p_comprobantes jsonb, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  m public.movimientos;
begin
  m := public._movimiento_manual_bloqueado(p_id);
  update public.movimientos
     set descripcion = case when p_descripcion is null then descripcion else btrim(p_descripcion) end,
         referencia = case when p_referencia is null then referencia else nullif(btrim(p_referencia), '') end,
         fecha = coalesce(p_fecha, fecha),
         comprobantes = coalesce(p_comprobantes, comprobantes)
   where id = p_id;
  return jsonb_build_object('movimientoId', p_id);
end;
$$;

-- Parte contable: banca(s), monto, moneda, monto destino y proveedor/cliente.
-- El tipo (ingreso/egreso/transferencia) no cambia. Valores finales.
create or replace function public.editar_movimiento_banca_contable(
  p_id uuid, p_banca_id uuid, p_banca_destino_id uuid, p_monto numeric, p_moneda text,
  p_monto_destino numeric, p_proveedor_id uuid, p_cliente_id uuid,
  p_descripcion text, p_referencia text, p_fecha date, p_comprobantes jsonb, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  m          public.movimientos;
  v_ids      uuid[];
  v_ini      jsonb;
  v_nombre   text;
  v_arch     boolean;
  v_mon_o    text;
  v_mon_d    text;
  v_dest     uuid;
  v_monto_d  numeric;
begin
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto debe ser mayor a 0.';
  end if;
  m := public._movimiento_manual_bloqueado(p_id);

  v_dest := case when m.tipo = 'transferencia' then p_banca_destino_id else null end;
  if m.tipo = 'transferencia' then
    if v_dest is null then raise exception 'Selecciona la banca destino.'; end if;
    if v_dest = p_banca_id then raise exception 'La banca destino debe ser distinta de la de origen.'; end if;
  end if;

  v_ids := array_remove(array[m.banca_origen_id, m.banca_destino_id, p_banca_id, v_dest], null);
  perform 1 from public.bancas where id = any(v_ids) order by id for update;

  select nombre, archivada, moneda into v_nombre, v_arch, v_mon_o from public.bancas where id = p_banca_id;
  if v_nombre is null then raise exception 'Banca no encontrada.'; end if;
  if v_arch and p_banca_id is distinct from m.banca_origen_id then
    raise exception 'La banca % esta archivada.', v_nombre;
  end if;
  if p_moneda is distinct from v_mon_o then
    raise exception 'La moneda indicada (%) no coincide con la de la banca % (%).', p_moneda, v_nombre, v_mon_o;
  end if;
  if v_dest is not null then
    select nombre, archivada, moneda into v_nombre, v_arch, v_mon_d from public.bancas where id = v_dest;
    if v_nombre is null then raise exception 'Banca destino no encontrada.'; end if;
    if v_arch and v_dest is distinct from m.banca_destino_id then
      raise exception 'La banca destino % esta archivada.', v_nombre;
    end if;
    if v_mon_d <> v_mon_o then
      if p_monto_destino is null or p_monto_destino <= 0 then
        raise exception 'Indica el monto que recibe la banca destino (monedas distintas).';
      end if;
      v_monto_d := p_monto_destino;
    else
      v_monto_d := null;
    end if;
  end if;

  v_ini := public._snapshot_saldos(v_ids);
  perform public._aplicar_efecto_saldo(m.tipo, m.banca_origen_id, m.banca_destino_id, m.monto, m.monto_destino, -1);

  update public.movimientos
     set banca_origen_id = p_banca_id,
         banca_destino_id = v_dest,
         monto = p_monto,
         moneda = p_moneda,
         monto_destino = v_monto_d,
         proveedor_id = p_proveedor_id,
         cliente_id = p_cliente_id,
         descripcion = case when p_descripcion is null then descripcion else btrim(p_descripcion) end,
         referencia = case when p_referencia is null then referencia else nullif(btrim(p_referencia), '') end,
         fecha = coalesce(p_fecha, fecha),
         comprobantes = coalesce(p_comprobantes, comprobantes)
   where id = p_id;

  perform public._aplicar_efecto_saldo(m.tipo, p_banca_id, v_dest, p_monto, v_monto_d, 1);
  perform public._verificar_saldos(v_ini);

  return jsonb_build_object('movimientoId', p_id);
end;
$$;

-- =====================================================================
-- 9. Permisos: solo el backend (service_role) ejecuta estas funciones
-- =====================================================================
revoke execute on function public._aplicar_efecto_saldo(text, uuid, uuid, numeric, numeric, int) from public, anon, authenticated;
revoke execute on function public._snapshot_saldos(uuid[]) from public, anon, authenticated;
revoke execute on function public._verificar_saldos(jsonb) from public, anon, authenticated;
revoke execute on function public._grupo_pago_contexto(uuid) from public, anon, authenticated;
revoke execute on function public._revertir_aplicaciones_grupo(boolean, uuid) from public, anon, authenticated;
revoke execute on function public._revertir_saldos_grupo(uuid) from public, anon, authenticated;
revoke execute on function public._movimiento_manual_bloqueado(uuid) from public, anon, authenticated;
revoke execute on function public.anular_pago_cobro(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.editar_pago_cobro_campos(uuid, text, text, date, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.editar_pago_cobro_contable(uuid, jsonb, numeric, jsonb, text, text, date, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.anular_movimiento_banca(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.editar_movimiento_banca_campos(uuid, text, text, date, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.editar_movimiento_banca_contable(uuid, uuid, uuid, numeric, text, numeric, uuid, uuid, text, text, date, jsonb, uuid) from public, anon, authenticated;

grant execute on function public._aplicar_efecto_saldo(text, uuid, uuid, numeric, numeric, int) to service_role;
grant execute on function public._snapshot_saldos(uuid[]) to service_role;
grant execute on function public._verificar_saldos(jsonb) to service_role;
grant execute on function public._grupo_pago_contexto(uuid) to service_role;
grant execute on function public._revertir_aplicaciones_grupo(boolean, uuid) to service_role;
grant execute on function public._revertir_saldos_grupo(uuid) to service_role;
grant execute on function public._movimiento_manual_bloqueado(uuid) to service_role;
grant execute on function public.anular_pago_cobro(uuid, text, uuid) to service_role;
grant execute on function public.editar_pago_cobro_campos(uuid, text, text, date, jsonb, uuid) to service_role;
grant execute on function public.editar_pago_cobro_contable(uuid, jsonb, numeric, jsonb, text, text, date, jsonb, uuid) to service_role;
grant execute on function public.anular_movimiento_banca(uuid, text, uuid) to service_role;
grant execute on function public.editar_movimiento_banca_campos(uuid, text, text, date, jsonb, uuid) to service_role;
grant execute on function public.editar_movimiento_banca_contable(uuid, uuid, uuid, numeric, text, numeric, uuid, uuid, text, text, date, jsonb, uuid) to service_role;

commit;
