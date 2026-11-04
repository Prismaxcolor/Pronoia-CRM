-- =============================================================================
-- ROLLBACK de docs/migration_mesa_cambio_cobro_parcial.sql
--
-- Orden: va ANTES que migration_mesa_cambio_transferencias_ROLLBACK.sql (si también se revierte esa).
--
-- Se niega a correr (y no cambia nada) si:
--   * hay transferencias vigentes en cobro PARCIAL: el destino recibió solo una parte y, sin mesa_monto_cobrado,
--     esa información se perdería. Complétalas (cobra el resto) o anúlalas desde Wallet primero.
--   * alguna transferencia tiene más de un asiento COBRO (cobros parciales, aunque estén anulados): el índice único
--     anterior (movimiento_id, tipo) no admite varios. Los asientos no se borran: resuélvelo con el administrador.
-- Las transferencias ya completadas conservan sus saldos (monto_destino = neto) y sus asientos.
-- Las anuladas que estaban en 'parcial' pasan a 'en_proceso' (el check anterior no admite 'parcial'; la anulación manda).
-- Haz un respaldo antes:
--   create table public._bak_movimientos_cobro_parcial as
--     select id, mesa_estado, mesa_monto_cobrado from public.movimientos where mesa_cambista_id is not null;
-- =============================================================================

begin;

do $$
begin
  if exists (select 1 from public.movimientos where mesa_estado = 'parcial' and not anulado) then
    raise exception 'Hay transferencias con cobro parcial: cobra el resto o anulalas antes del rollback.';
  end if;
  if exists (
    select 1 from public.cambista_asientos where movimiento_id is not null and tipo = 'COBRO'
     group by movimiento_id having count(*) > 1
  ) then
    raise exception 'Hay transferencias con mas de un asiento COBRO (cobros parciales): resuelve con el administrador antes del rollback.';
  end if;
end $$;

select set_config('app.mesa_cambio_rpc', 'on', true);

update public.movimientos set mesa_estado = 'en_proceso' where mesa_estado = 'parcial';

-- RPC nueva fuera; las anteriores vuelven a su versión de migration_mesa_cambio_transferencias.sql
drop function if exists public.cobrar_transferencia_mesa_cambio(uuid, numeric, numeric, uuid);

-- 2b. Saldo recalculado: el destino de una transferencia en proceso no cuenta.
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
           when tipo = 'transferencia' and banca_destino_id = p_banca_id
                and mesa_estado is distinct from 'en_proceso' then coalesce(monto_destino, monto)
           else 0
         end), 0)
    into v_saldo
    from public.movimientos
   where not anulado;

  update public.bancas set saldo = v_saldo where id = p_banca_id;
  return v_saldo;
end;
$function$;

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
     or new.mesa_comision is distinct from old.mesa_comision then
    raise exception 'Esta transferencia usa una mesa de cambio: se completa o se anula desde su detalle en Wallet; no se pueden cambiar sus importes ni sus cuentas.';
  end if;
  return new;
end;
$function$;

-- 3b. Completar: acredita el neto al destino y salda el CARGO con un COBRO. Idempotente.
create or replace function public.completar_transferencia_mesa_cambio(p_movimiento_id uuid, p_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m        public.movimientos;
  v_neto   numeric;
  v_cargo  public.cambista_asientos;
  v_nom_d  text;
  v_arch_d boolean;
  v_dia    date := (now() at time zone 'America/Caracas')::date;
  v_as_id  uuid;
begin
  perform set_config('app.mesa_cambio_rpc', 'on', true);
  if p_usuario is null then raise exception 'Falta el usuario que completa la transferencia.'; end if;

  select * into m from public.movimientos where id = p_movimiento_id for update;
  if not found then raise exception 'Transferencia no encontrada.'; end if;
  if m.mesa_cambista_id is null then raise exception 'Este movimiento no es una transferencia con mesa de cambio.'; end if;
  if m.anulado then raise exception 'Esta transferencia fue anulada y no se puede completar.'; end if;
  if m.mesa_estado = 'completada' then
    return jsonb_build_object('movimientoId', m.id, 'yaCompletada', true, 'montoAcreditado', coalesce(m.monto_destino, m.monto));
  end if;

  select nombre, archivada into v_nom_d, v_arch_d from public.bancas where id = m.banca_destino_id for update;
  if v_nom_d is null then raise exception 'Cuenta de destino no encontrada.'; end if;
  if v_arch_d then raise exception 'La cuenta % está archivada: restáurala antes de completar.', v_nom_d; end if;

  select * into v_cargo from public.cambista_asientos
   where movimiento_id = m.id and tipo = 'CARGO' and not anulado;
  if not found then raise exception 'No se encontró el asiento de deuda de esta transferencia. Avisa al administrador.'; end if;

  v_neto := round(m.mesa_monto_bruto - coalesce(m.mesa_comision, 0), 2);
  update public.bancas set saldo = saldo + v_neto where id = m.banca_destino_id;

  update public.movimientos
     set mesa_estado = 'completada', mesa_completada_at = now(), mesa_completada_por = p_usuario,
         monto_destino = case when m.monto_destino is null and v_neto = m.monto then null else v_neto end
   where id = m.id;

  insert into public.cambista_asientos
    (cambista_id, tipo, monto_usd, fecha, nota, referencia, registrado_por, movimiento_id)
  values
    (m.mesa_cambista_id, 'COBRO', v_cargo.monto_usd, v_dia,
     'Transferencia ' || coalesce('MV-' || lpad(m.numero_sistema::text, 4, '0') || ' ', '') || 'completada',
     m.referencia, p_usuario, m.id)
  returning id into v_as_id;

  return jsonb_build_object(
    'movimientoId', m.id, 'yaCompletada', false, 'montoAcreditado', v_neto, 'comision', coalesce(m.mesa_comision, 0),
    'asientoId', v_as_id);
end;
$$;

-- 3c. Anular (motivo obligatorio): en proceso revierte solo el origen; completada, origen y destino.
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

revoke execute on function public.movimientos_mesa_proteger() from public, anon, authenticated;
revoke execute on function public.completar_transferencia_mesa_cambio(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.anular_transferencia_mesa_cambio(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.completar_transferencia_mesa_cambio(uuid, uuid) to service_role;
grant execute on function public.anular_transferencia_mesa_cambio(uuid, text, uuid) to service_role;

-- Restricciones, índice y columna
alter table public.movimientos drop constraint if exists movimientos_mesa_cobrado_valido;
alter table public.movimientos drop constraint if exists movimientos_mesa_coherente;
alter table public.movimientos add constraint movimientos_mesa_coherente check (
  (mesa_cambista_id is null and mesa_estado is null)
  or (mesa_cambista_id is not null and tipo = 'transferencia' and mesa_estado in ('en_proceso', 'completada'))
);
drop index if exists public.idx_cambista_asientos_movimiento_tipo;
create unique index if not exists idx_cambista_asientos_movimiento_tipo
  on public.cambista_asientos (movimiento_id, tipo) where movimiento_id is not null;
alter table public.movimientos drop column if exists mesa_monto_cobrado;

commit;

notify pgrst, 'reload schema';
