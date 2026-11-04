-- =============================================================================
-- Mesa de cambio, parte 3: cobro parcial de una transferencia con cambista.
-- Diseño: docs/DISENO_mesa_cambio_transferencias.md (sección "Cobro parcial"). NO edita
-- docs/migration_mesa_cambio_transferencias.sql (se aplica antes, por separado).
--
-- Problema: el cambista a veces entrega solo una parte de lo acordado. Antes, completar acreditaba TODO el neto
-- de golpe y saldaba la deuda completa. Ahora cada cobro acredita lo cobrado y salda la parte proporcional.
--
-- 1. movimientos
--    * mesa_monto_cobrado: neto ya acreditado al destino (moneda destino). Pendiente = (bruto - comisión) - cobrado.
--      Backfill: 'completada' => lo acreditado (coalesce(monto_destino, monto)); 'en_proceso' => 0.
--    * mesa_estado admite 'parcial' (se cobró algo, falta el resto). 'completada' = pendiente 0.
--    * Saldo del destino (única fuente de verdad: los movimientos):
--        en_proceso => 0 | parcial => mesa_monto_cobrado | completada => coalesce(monto_destino, monto).
--      reconciliar_saldo_banca y la anulación se redefinen con esa regla. Al completar del todo, monto_destino pasa
--      a ser el neto (igual que antes), así que "completada" sigue siendo compatible con todo lo existente.
--    * El guardián trigger protege también mesa_monto_cobrado: solo las RPC de la mesa lo cambian.
-- 2. cambista_asientos
--    * Un movimiento puede tener VARIOS asientos COBRO (uno por cobro). El índice único (movimiento_id, tipo)
--      pasa a excluir COBRO; CARGO (y el resto) siguen siendo únicos por movimiento.
--    * Cada COBRO lleva el USD proporcional al neto cobrado; el que completa toma el resto exacto del CARGO,
--      así la suma de los COBRO iguala al CARGO y el saldo del cambista vuelve a 0 sin deriva de redondeo.
-- 3. RPC (security definer, search_path fijo, solo service_role)
--    * cobrar_transferencia_mesa_cambio(movimiento, monto|null, pendiente_esperado|null, usuario): cobra el monto
--      indicado (null = todo lo pendiente). Si pendiente_esperado no coincide con el pendiente real (doble clic,
--      otro usuario cobró) rechaza sin mover nada. Con el estado 'completada' devuelve yaCompletada sin acreditar.
--    * completar_transferencia_mesa_cambio(movimiento, usuario) se conserva como envoltorio (cobra todo lo pendiente).
--    * anular_transferencia_mesa_cambio: revierte el origen y lo ya acreditado al destino (parcial o completada).
--    La foto/comprobante del cobro la adjunta el backend después, agregándola a movimientos.comprobantes (el tipo de
--    esa columna varía entre despliegues: text[] / jsonb).
--
-- Idempotente (IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS). No inserta datos de negocio.
-- Requisito: migration_mesa_cambio_transferencias.sql aplicada. Haz backup antes de aplicar.
-- ROLLBACK: docs/migration_mesa_cambio_cobro_parcial_ROLLBACK.sql.
-- Mientras no esté aplicada, el backend completa (cobro total) con la RPC anterior y el cobro parcial responde 503.
-- =============================================================================

begin;

-- 1. movimientos ---------------------------------------------------------------
-- El backfill actualiza filas protegidas por trg_movimientos_mesa_proteger: se autoriza como RPC de la mesa.
select set_config('app.mesa_cambio_rpc', 'on', true);

alter table public.movimientos
  add column if not exists mesa_monto_cobrado numeric;

update public.movimientos
   set mesa_monto_cobrado = coalesce(monto_destino, monto)
 where mesa_cambista_id is not null and mesa_estado = 'completada' and mesa_monto_cobrado is null;

update public.movimientos
   set mesa_monto_cobrado = 0
 where mesa_cambista_id is not null and mesa_estado = 'en_proceso' and mesa_monto_cobrado is null;

alter table public.movimientos drop constraint if exists movimientos_mesa_coherente;
alter table public.movimientos add constraint movimientos_mesa_coherente check (
  (mesa_cambista_id is null and mesa_estado is null)
  or (mesa_cambista_id is not null and tipo = 'transferencia' and mesa_estado in ('en_proceso', 'parcial', 'completada'))
);
alter table public.movimientos drop constraint if exists movimientos_mesa_cobrado_valido;
alter table public.movimientos add constraint movimientos_mesa_cobrado_valido check (
  mesa_monto_cobrado is null or mesa_monto_cobrado >= 0
);

-- 2. cambista_asientos: varios COBRO por transferencia ------------------------------
drop index if exists public.idx_cambista_asientos_movimiento_tipo;
create unique index if not exists idx_cambista_asientos_movimiento_tipo
  on public.cambista_asientos (movimiento_id, tipo) where movimiento_id is not null and tipo <> 'COBRO';

-- 3. Saldo recalculado: en proceso no cuenta; parcial cuenta lo cobrado; completada, lo acreditado ------
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
           when tipo = 'transferencia' and banca_destino_id = p_banca_id and mesa_estado = 'en_proceso' then 0
           when tipo = 'transferencia' and banca_destino_id = p_banca_id and mesa_estado = 'parcial'
                then coalesce(mesa_monto_cobrado, 0)
           when tipo = 'transferencia' and banca_destino_id = p_banca_id then coalesce(monto_destino, monto)
           else 0
         end), 0)
    into v_saldo
    from public.movimientos
   where not anulado;

  update public.bancas set saldo = v_saldo where id = p_banca_id;
  return v_saldo;
end;
$function$;

-- 4. Guardián: ahora también protege mesa_monto_cobrado -----------------------------
create or replace function public.movimientos_mesa_proteger()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if coalesce(current_setting('app.mesa_cambio_rpc', true), '') = 'on' then
    return new;
  end if;
  if new.anulado is distinct from old.anulado
     or new.tipo is distinct from old.tipo
     or new.monto is distinct from old.monto
     or new.moneda is distinct from old.moneda
     or new.monto_destino is distinct from old.monto_destino
     or new.monto_usd is distinct from old.monto_usd
     or new.banca_origen_id is distinct from old.banca_origen_id
     or new.banca_destino_id is distinct from old.banca_destino_id
     or new.proveedor_id is distinct from old.proveedor_id
     or new.cliente_id is distinct from old.cliente_id
     or new.mesa_cambista_id is distinct from old.mesa_cambista_id
     or new.mesa_estado is distinct from old.mesa_estado
     or new.mesa_monto_bruto is distinct from old.mesa_monto_bruto
     or new.mesa_comision_modo is distinct from old.mesa_comision_modo
     or new.mesa_comision_pct is distinct from old.mesa_comision_pct
     or new.mesa_comision is distinct from old.mesa_comision
     or new.mesa_monto_cobrado is distinct from old.mesa_monto_cobrado then
    raise exception 'Esta transferencia usa una mesa de cambio: se completa o se anula desde su detalle en Wallet; no se pueden cambiar sus importes ni sus cuentas.';
  end if;
  return new;
end;
$function$;

revoke execute on function public.movimientos_mesa_proteger() from public, anon, authenticated;

-- 5. RPC -------------------------------------------------------------------------

-- 5a. Cobrar (total o parcial): acredita lo cobrado al destino y salda esa parte del CARGO con un COBRO.
create or replace function public.cobrar_transferencia_mesa_cambio(
  p_movimiento_id uuid, p_monto numeric, p_pendiente_esperado numeric, p_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m          public.movimientos;
  v_neto     numeric;
  v_cobrado  numeric;
  v_pend     numeric;
  v_cobro    numeric;
  v_nuevo    numeric;
  v_completa boolean;
  v_cargo    public.cambista_asientos;
  v_usd_ya   numeric;
  v_usd      numeric;
  v_nom_d    text;
  v_arch_d   boolean;
  v_dia      date := (now() at time zone 'America/Caracas')::date;
  v_mv       text;
  v_nota     text;
  v_as_id    uuid;
begin
  perform set_config('app.mesa_cambio_rpc', 'on', true);
  if p_usuario is null then raise exception 'Falta el usuario que registra el cobro.'; end if;

  select * into m from public.movimientos where id = p_movimiento_id for update;
  if not found then raise exception 'Transferencia no encontrada.'; end if;
  if m.mesa_cambista_id is null then raise exception 'Este movimiento no es una transferencia con mesa de cambio.'; end if;
  if m.anulado then raise exception 'Esta transferencia fue anulada y no se puede cobrar.'; end if;

  v_neto    := round(m.mesa_monto_bruto - coalesce(m.mesa_comision, 0), 2);
  v_cobrado := coalesce(m.mesa_monto_cobrado, 0);
  if m.mesa_estado = 'completada' then
    return jsonb_build_object('movimientoId', m.id, 'yaCompletada', true, 'completada', true, 'montoAcreditado', 0,
      'montoCobrado', coalesce(m.mesa_monto_cobrado, coalesce(m.monto_destino, m.monto)), 'montoPendiente', 0);
  end if;

  v_pend := round(v_neto - v_cobrado, 2);
  if p_pendiente_esperado is not null and round(p_pendiente_esperado, 2) <> v_pend then
    raise exception 'El pendiente cambió: ahora faltan %. Revisa y vuelve a intentar.', v_pend;
  end if;
  v_cobro := coalesce(round(p_monto, 2), v_pend);
  if v_cobro <= 0 then raise exception 'El monto a cobrar debe ser mayor a 0.'; end if;
  if v_cobro > v_pend then
    raise exception 'El monto a cobrar (%) supera lo pendiente (%).', v_cobro, v_pend;
  end if;
  v_nuevo    := round(v_cobrado + v_cobro, 2);
  v_completa := v_nuevo = v_neto;

  select nombre, archivada into v_nom_d, v_arch_d from public.bancas where id = m.banca_destino_id for update;
  if v_nom_d is null then raise exception 'Cuenta de destino no encontrada.'; end if;
  if v_arch_d then raise exception 'La cuenta % está archivada: restáurala antes de cobrar.', v_nom_d; end if;

  select * into v_cargo from public.cambista_asientos
   where movimiento_id = m.id and tipo = 'CARGO' and not anulado;
  if not found then raise exception 'No se encontró el asiento de deuda de esta transferencia. Avisa al administrador.'; end if;

  select coalesce(sum(monto_usd), 0) into v_usd_ya from public.cambista_asientos
   where movimiento_id = m.id and tipo = 'COBRO' and not anulado;
  -- El cobro que completa toma el resto exacto del CARGO (la suma de los COBRO iguala al CARGO sin deriva).
  v_usd := case when v_completa then round(v_cargo.monto_usd - v_usd_ya, 2)
                else round(v_cargo.monto_usd * v_cobro / v_neto, 2) end;
  -- Un cobro tan pequeño que redondea a 0 USD acredita el destino sin asiento COBRO (monto_usd > 0 por constraint);
  -- el último cobro toma el resto exacto del CARGO, así que la deuda del cambista no deriva.
  if v_usd < 0 then v_usd := 0; end if;

  update public.bancas set saldo = saldo + v_cobro where id = m.banca_destino_id;

  update public.movimientos
     set mesa_monto_cobrado = v_nuevo,
         mesa_estado = case when v_completa then 'completada' else 'parcial' end,
         mesa_completada_at  = case when v_completa then now() else mesa_completada_at end,
         mesa_completada_por = case when v_completa then p_usuario else mesa_completada_por end,
         monto_destino = case when not v_completa then monto_destino
                              when m.monto_destino is null and v_neto = m.monto then null
                              else v_neto end
   where id = m.id;

  v_mv := coalesce('MV-' || lpad(m.numero_sistema::text, 4, '0') || ' ', '');
  v_nota := case
    when v_completa and v_cobrado = 0 then 'Transferencia ' || v_mv || 'completada'
    when v_completa then 'Transferencia ' || v_mv || 'completada (último cobro)'
    else 'Cobro parcial de la transferencia ' || v_mv || '(' || v_nuevo || ' de ' || v_neto || ')'
  end;

  if v_usd > 0 then
    insert into public.cambista_asientos
      (cambista_id, tipo, monto_usd, fecha, nota, referencia, registrado_por, movimiento_id)
    values
      (m.mesa_cambista_id, 'COBRO', v_usd, v_dia, v_nota, m.referencia, p_usuario, m.id)
    returning id into v_as_id;
  end if;

  return jsonb_build_object(
    'movimientoId', m.id, 'yaCompletada', false, 'completada', v_completa, 'montoAcreditado', v_cobro,
    'montoCobrado', v_nuevo, 'montoPendiente', round(v_neto - v_nuevo, 2), 'montoUsd', v_usd,
    'comision', coalesce(m.mesa_comision, 0), 'asientoId', v_as_id);
end;
$$;

-- 5b. Completar (firma anterior): cobra todo lo pendiente.
create or replace function public.completar_transferencia_mesa_cambio(p_movimiento_id uuid, p_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.cobrar_transferencia_mesa_cambio(p_movimiento_id, null, null, p_usuario);
end;
$$;

-- 5c. Anular (motivo obligatorio): revierte el origen y lo ya acreditado al destino (parcial o completada).
create or replace function public.anular_transferencia_mesa_cambio(p_movimiento_id uuid, p_motivo text, p_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m     public.movimientos;
  v_ids uuid[];
  v_ini jsonb;
  v_n   int;
begin
  perform set_config('app.mesa_cambio_rpc', 'on', true);
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'El motivo de la anulación es obligatorio.'; end if;

  select * into m from public.movimientos where id = p_movimiento_id for update;
  if not found then raise exception 'Transferencia no encontrada.'; end if;
  if m.mesa_cambista_id is null then raise exception 'Este movimiento no es una transferencia con mesa de cambio.'; end if;
  if m.anulado then raise exception 'Esta transferencia ya fue anulada.'; end if;

  v_ids := array[m.banca_origen_id, m.banca_destino_id];
  perform 1 from public.bancas where id = any(v_ids) order by id for update;
  v_ini := public._snapshot_saldos(v_ids);

  update public.bancas set saldo = saldo + m.monto where id = m.banca_origen_id;
  if m.mesa_estado = 'completada' then
    update public.bancas set saldo = saldo - coalesce(m.monto_destino, m.monto) where id = m.banca_destino_id;
  elsif m.mesa_estado = 'parcial' then
    update public.bancas set saldo = saldo - coalesce(m.mesa_monto_cobrado, 0) where id = m.banca_destino_id;
  end if;

  update public.movimientos
     set anulado = true, anulado_at = now(), anulado_por = p_usuario, anulado_motivo = btrim(p_motivo)
   where id = m.id;

  update public.cambista_asientos
     set anulado = true, anulado_at = now(), anulado_por = p_usuario,
         anulado_motivo = 'Transferencia anulada: ' || btrim(p_motivo)
   where movimiento_id = m.id and not anulado;
  get diagnostics v_n = row_count;

  perform public._verificar_saldos(v_ini);

  return jsonb_build_object('movimientoId', m.id, 'estadoPrevio', m.mesa_estado, 'asientosAnulados', v_n);
end;
$$;

-- 6. Permisos: solo el backend (service_role) ejecuta las RPC ----------------------
revoke execute on function public.cobrar_transferencia_mesa_cambio(uuid, numeric, numeric, uuid) from public, anon, authenticated;
revoke execute on function public.completar_transferencia_mesa_cambio(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.anular_transferencia_mesa_cambio(uuid, text, uuid) from public, anon, authenticated;

grant execute on function public.cobrar_transferencia_mesa_cambio(uuid, numeric, numeric, uuid) to service_role;
grant execute on function public.completar_transferencia_mesa_cambio(uuid, uuid) to service_role;
grant execute on function public.anular_transferencia_mesa_cambio(uuid, text, uuid) to service_role;

commit;

-- Recarga el esquema de PostgREST (columna y función nuevas visibles para el backend sin reiniciar).
notify pgrst, 'reload schema';

-- Verificación a mano (solo lectura, después de aplicar):
--   -- Pendiente por cobrar de las transferencias en proceso o parciales:
--   select id, numero_sistema, mesa_estado, mesa_monto_bruto - coalesce(mesa_comision, 0) as neto,
--          coalesce(mesa_monto_cobrado, 0) as cobrado,
--          mesa_monto_bruto - coalesce(mesa_comision, 0) - coalesce(mesa_monto_cobrado, 0) as pendiente
--     from public.movimientos
--    where mesa_cambista_id is not null and not anulado and mesa_estado in ('en_proceso', 'parcial');
--   -- En una transferencia completada, la suma de COBRO vigentes debe igualar su CARGO (debe dar 0 filas):
--   select a.movimiento_id,
--          sum(a.monto_usd) filter (where a.tipo = 'CARGO') as cargo, sum(a.monto_usd) filter (where a.tipo = 'COBRO') as cobros
--     from public.cambista_asientos a join public.movimientos m on m.id = a.movimiento_id
--    where not a.anulado and not m.anulado and m.mesa_estado = 'completada'
--    group by a.movimiento_id
--   having sum(a.monto_usd) filter (where a.tipo = 'CARGO') is distinct from sum(a.monto_usd) filter (where a.tipo = 'COBRO');
