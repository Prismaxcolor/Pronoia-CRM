-- =============================================================================
-- Mesa de cambio, parte 4: la comisión de la mesa es un MOVIMIENTO PROPIO con categoría.
-- NO edita migration_mesa_cambio_transferencias.sql ni migration_mesa_cambio_cobro_parcial.sql (se aplican antes).
--
-- Antes: la comisión solo reducía lo acreditado al destino (neto = bruto - comisión) y vivía como dato del movimiento
-- (mesa_comision); no había ningún movimiento de Wallet con ese gasto, así que no salía en reportes por categoría.
--
-- Ahora, al COMPLETAR la transferencia (el último cobro) con comisión > 0:
--   * se crea un EGRESO en la cuenta destino por la comisión (moneda del destino), categoría "Comisión cambio de
--     divisas", ligado a la transferencia (movimientos.mesa_comision_de_id);
--   * la transferencia pasa a registrar el BRUTO como monto_destino (lo que entregó el cambista) y el egreso resta la
--     comisión: el saldo del destino queda igual que antes (bruto - comisión = neto). No cambia ningún saldo.
--     El trigger de saldo descuenta el egreso; la RPC acredita la comisión de más para que el neto final no cambie.
--   * al ANULAR la transferencia se anula también su egreso de comisión (y se revierte su efecto en el saldo).
--   * el egreso de comisión no se edita ni se anula por separado (guardián trigger, igual que las demás mesas).
-- Las transferencias ya completadas antes de esta migración no tienen egreso: se anulan como siempre (sin cambios).
-- Cobros parciales: no crean el egreso hasta el último cobro.
--
-- 1. movimientos.mesa_comision_de_id (uuid, FK a movimientos, único): transferencia a la que pertenece la comisión.
--    NO se reutiliza comision_de_id: ese lo fuerza a "COMISIONES BANCARIAS" el trigger de comisiones bancarias.
-- 2. Categoría "Comisión cambio de divisas" (EGRESO, bajo GASTOS FINANCIEROS si existe). Se crea si no existe; la RPC la
--    busca por nombre (sin tildes ni mayúsculas) y, si no hay ninguna activa, el egreso queda sin categoría.
-- 3. RPC cobrar_transferencia_mesa_cambio y anular_transferencia_mesa_cambio redefinidas (resto idéntico a cobro parcial).
--
-- Idempotente (IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS). Haz backup antes de aplicar. NO se aplica sola.
-- Requisitos: migration_mesa_cambio_cobro_parcial.sql y migration_wallet_categorias.sql.
-- ROLLBACK: docs/migration_mesa_cambio_comision_movimiento_ROLLBACK.sql.
-- Mientras no esté aplicada, el backend completa como antes (la comisión solo reduce lo acreditado).
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.categorias_wallet') is null then
    raise exception 'Falta migration_wallet_categorias.sql: aplícala antes.';
  end if;
  if not exists (select 1 from pg_proc where proname = 'cobrar_transferencia_mesa_cambio') then
    raise exception 'Falta migration_mesa_cambio_cobro_parcial.sql: aplícala antes.';
  end if;
end $$;

-- 1. Columna de enlace -------------------------------------------------------------
alter table public.movimientos
  add column if not exists mesa_comision_de_id uuid references public.movimientos(id) on delete restrict;

alter table public.movimientos drop constraint if exists movimientos_mesa_comision_de_coherente;
alter table public.movimientos add constraint movimientos_mesa_comision_de_coherente check (
  mesa_comision_de_id is null or (mesa_comision_de_id <> id and tipo = 'egreso')
);

create unique index if not exists idx_movimientos_mesa_comision_de
  on public.movimientos (mesa_comision_de_id) where mesa_comision_de_id is not null;

-- 2. Categoría -----------------------------------------------------------------------
do $$
declare
  c_nombre constant text := 'Comisión cambio de divisas';
  v_padre  uuid;
begin
  if exists (
    select 1 from public.categorias_wallet
     where translate(lower(btrim(nombre)), 'áéíóú', 'aeiou') = 'comision cambio de divisas'
  ) then
    return;
  end if;

  select id into v_padre
    from public.categorias_wallet
   where upper(btrim(nombre)) = 'GASTOS FINANCIEROS' and padre_id is null and activo and tipo in ('EGRESO', 'AMBOS')
   order by created_at
   limit 1;

  insert into public.categorias_wallet (nombre, tipo, padre_id) values (c_nombre, 'EGRESO', v_padre);
end $$;

-- 3. Guardián del egreso de comisión: solo las RPC de la mesa lo cambian o anulan --------------
create or replace function public.movimientos_mesa_comision_proteger()
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
     or new.banca_origen_id is distinct from old.banca_origen_id
     or new.mesa_comision_de_id is distinct from old.mesa_comision_de_id then
    raise exception 'Este movimiento es la comisión de una transferencia con mesa de cambio: se anula junto con la transferencia; no se pueden cambiar su importe ni su cuenta.';
  end if;
  return new;
end;
$function$;

revoke execute on function public.movimientos_mesa_comision_proteger() from public, anon, authenticated;

drop trigger if exists trg_movimientos_mesa_comision_proteger on public.movimientos;
create trigger trg_movimientos_mesa_comision_proteger
  before update on public.movimientos
  for each row
  when (old.mesa_comision_de_id is not null)
  execute function public.movimientos_mesa_comision_proteger();

-- 4a. Cobrar (total o parcial). Igual que cobro parcial; el cobro que completa con comisión > 0 crea el egreso. -----
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
  v_mon_d    text;
  v_arch_d   boolean;
  v_dia      date := (now() at time zone 'America/Caracas')::date;
  v_mv       text;
  v_nota     text;
  v_as_id    uuid;
  v_comision numeric;
  v_con_com  boolean;
  v_cat      uuid;
  v_com_id   uuid;
  v_com_usd  numeric;
begin
  perform set_config('app.mesa_cambio_rpc', 'on', true);
  if p_usuario is null then raise exception 'Falta el usuario que registra el cobro.'; end if;

  select * into m from public.movimientos where id = p_movimiento_id for update;
  if not found then raise exception 'Transferencia no encontrada.'; end if;
  if m.mesa_cambista_id is null then raise exception 'Este movimiento no es una transferencia con mesa de cambio.'; end if;
  if m.anulado then raise exception 'Esta transferencia fue anulada y no se puede cobrar.'; end if;

  v_comision := coalesce(m.mesa_comision, 0);
  v_neto     := round(m.mesa_monto_bruto - v_comision, 2);
  v_cobrado  := coalesce(m.mesa_monto_cobrado, 0);
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
  v_con_com  := v_completa and v_comision > 0;

  select nombre, moneda, archivada into v_nom_d, v_mon_d, v_arch_d from public.bancas where id = m.banca_destino_id for update;
  if v_nom_d is null then raise exception 'Cuenta de destino no encontrada.'; end if;
  if v_arch_d then raise exception 'La cuenta % está archivada: restáurala antes de cobrar.', v_nom_d; end if;

  select * into v_cargo from public.cambista_asientos
   where movimiento_id = m.id and tipo = 'CARGO' and not anulado;
  if not found then raise exception 'No se encontró el asiento de deuda de esta transferencia. Avisa al administrador.'; end if;

  select coalesce(sum(monto_usd), 0) into v_usd_ya from public.cambista_asientos
   where movimiento_id = m.id and tipo = 'COBRO' and not anulado;
  v_usd := case when v_completa then round(v_cargo.monto_usd - v_usd_ya, 2)
                else round(v_cargo.monto_usd * v_cobro / v_neto, 2) end;
  if v_usd < 0 then v_usd := 0; end if;

  -- Con comisión, el destino recibe además la comisión que el egreso (trigger de saldo) vuelve a descontar: saldo neto igual.
  update public.bancas set saldo = saldo + v_cobro + case when v_con_com then v_comision else 0 end
   where id = m.banca_destino_id;

  update public.movimientos
     set mesa_monto_cobrado = v_nuevo,
         mesa_estado = case when v_completa then 'completada' else 'parcial' end,
         mesa_completada_at  = case when v_completa then now() else mesa_completada_at end,
         mesa_completada_por = case when v_completa then p_usuario else mesa_completada_por end,
         monto_destino = case when not v_completa then monto_destino
                              -- Con egreso de comisión la transferencia registra el BRUTO (el egreso resta la comisión).
                              when v_con_com and m.monto_destino is null and m.mesa_monto_bruto = m.monto then null
                              when v_con_com then m.mesa_monto_bruto
                              when m.monto_destino is null and v_neto = m.monto then null
                              else v_neto end
   where id = m.id;

  v_mv := coalesce('MV-' || lpad(m.numero_sistema::text, 4, '0') || ' ', '');

  if v_con_com then
    select id into v_cat from public.categorias_wallet
     where translate(lower(btrim(nombre)), 'áéíóú', 'aeiou') = 'comision cambio de divisas'
       and activo and tipo in ('EGRESO', 'AMBOS')
     order by created_at limit 1;
    -- USD proporcional a la comisión (null si no hay equivalente o redondea a 0: monto_usd debe ser > 0).
    v_com_usd := nullif(round(coalesce(m.monto_usd, 0) * v_comision / m.mesa_monto_bruto, 2), 0);
    insert into public.movimientos
      (tipo, monto, moneda, descripcion, banca_origen_id, fecha, referencia, registrado_por,
       monto_usd, categoria_id, mesa_comision_de_id)
    values
      ('egreso', v_comision, v_mon_d, 'Comisión cambio de divisas — transferencia ' || btrim(v_mv),
       m.banca_destino_id, v_dia, m.referencia, p_usuario, v_com_usd, v_cat, m.id)
    returning id into v_com_id;
  end if;

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
    'comision', v_comision, 'asientoId', v_as_id, 'comisionMovimientoId', v_com_id);
end;
$$;

-- 4b. Anular: igual que cobro parcial; además anula el egreso de comisión (si lo hay) y revierte su efecto. ----------
create or replace function public.anular_transferencia_mesa_cambio(p_movimiento_id uuid, p_motivo text, p_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m     public.movimientos;
  c     public.movimientos;
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

  -- Egreso de comisión: la transferencia completada registraba el bruto; al anular el egreso el destino devuelve solo el neto.
  select * into c from public.movimientos where mesa_comision_de_id = m.id and not anulado for update;
  if found then
    update public.bancas set saldo = saldo + c.monto where id = c.banca_origen_id;
    update public.movimientos
       set anulado = true, anulado_at = now(), anulado_por = p_usuario,
           anulado_motivo = 'Transferencia anulada: ' || btrim(p_motivo)
     where id = c.id;
  end if;

  update public.cambista_asientos
     set anulado = true, anulado_at = now(), anulado_por = p_usuario,
         anulado_motivo = 'Transferencia anulada: ' || btrim(p_motivo)
   where movimiento_id = m.id and not anulado;
  get diagnostics v_n = row_count;

  perform public._verificar_saldos(v_ini);

  return jsonb_build_object('movimientoId', m.id, 'estadoPrevio', m.mesa_estado, 'asientosAnulados', v_n);
end;
$$;

revoke execute on function public.cobrar_transferencia_mesa_cambio(uuid, numeric, numeric, uuid) from public, anon, authenticated;
revoke execute on function public.anular_transferencia_mesa_cambio(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.cobrar_transferencia_mesa_cambio(uuid, numeric, numeric, uuid) to service_role;
grant execute on function public.anular_transferencia_mesa_cambio(uuid, text, uuid) to service_role;

commit;

-- Recarga el esquema de PostgREST (columna nueva visible para el backend sin reiniciar).
notify pgrst, 'reload schema';

-- Verificación a mano (solo lectura, después de aplicar):
--   -- Cada transferencia completada CON egreso de comisión: monto_destino (o monto) - egreso = neto acreditado (debe dar 0 filas):
--   select m.id, m.numero_sistema, coalesce(m.monto_destino, m.monto) as registrado, c.monto as comision,
--          round(m.mesa_monto_bruto - coalesce(m.mesa_comision, 0), 2) as neto_esperado
--     from public.movimientos m join public.movimientos c on c.mesa_comision_de_id = m.id and not c.anulado
--    where m.mesa_estado = 'completada' and not m.anulado
--      and round(coalesce(m.monto_destino, m.monto) - c.monto, 2) <> round(m.mesa_monto_bruto - coalesce(m.mesa_comision, 0), 2);
--   -- Saldos vs movimientos (usa docs/verificar_contabilidad_wallet.sql, consulta 1).
