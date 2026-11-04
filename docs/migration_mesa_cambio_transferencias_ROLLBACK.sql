-- =============================================================================
-- ROLLBACK de docs/migration_mesa_cambio_transferencias.sql
--
-- Orden: este script va ANTES que migration_mesa_cambio_ROLLBACK.sql (movimientos referencia a cambistas).
--
-- Se niega a correr (y no cambia nada) si:
--   * hay transferencias con mesa de cambio EN PROCESO vigentes: el destino aún no recibió su saldo y,
--     sin las columnas mesa_*, esa información se perdería. Complétalas o anúlalas desde Wallet primero.
--   * existen asientos N/C o N/D (aunque estén anulados): los asientos no se borran y el check antiguo
--     no los admite. Respáldalos aparte y decide con el administrador.
-- Las transferencias ya completadas quedan como transferencias normales (saldos intactos); pierden el
-- vínculo con su cambista y con sus asientos (los asientos CARGO/COBRO se conservan como manuales).
-- Haz un respaldo antes:
--   create table public._bak_movimientos_mesa as
--     select id, mesa_cambista_id, mesa_estado, mesa_monto_bruto, mesa_comision_modo, mesa_comision_pct, mesa_comision,
--            mesa_completada_at, mesa_completada_por from public.movimientos where mesa_cambista_id is not null;
--   create table public._bak_cambista_asientos_vinculo as
--     select id, movimiento_id, numero_nota from public.cambista_asientos
--      where movimiento_id is not null or numero_nota is not null;
-- =============================================================================

begin;

do $$
begin
  if exists (select 1 from public.movimientos where mesa_estado = 'en_proceso' and not anulado) then
    raise exception 'Hay transferencias con mesa de cambio en proceso: completalas o anulalas antes del rollback.';
  end if;
  if exists (select 1 from public.cambista_asientos where tipo in ('NC', 'ND')) then
    raise exception 'Hay notas de credito/debito (N/C, N/D) registradas: respaldalas y resuelve con el administrador antes del rollback.';
  end if;
end $$;

-- RPC y guardianes
drop function if exists public.crear_transferencia_mesa_cambio(uuid, uuid, uuid, numeric, numeric, numeric, text, numeric, text, text, date, uuid);
drop function if exists public.completar_transferencia_mesa_cambio(uuid, uuid);
drop function if exists public.anular_transferencia_mesa_cambio(uuid, text, uuid);
drop trigger if exists trg_movimientos_mesa_proteger on public.movimientos;
drop function if exists public.movimientos_mesa_proteger();

-- Funciones de saldo: versiones anteriores (sin el caso "en proceso")
create or replace function public.aplicar_movimiento_a_saldo()
returns trigger
language plpgsql
as $$
begin
  if new.tipo = 'ingreso' then
    update public.bancas set saldo = saldo + new.monto where id = new.banca_origen_id;
  elsif new.tipo = 'egreso' then
    update public.bancas set saldo = saldo - new.monto where id = new.banca_origen_id;
  elsif new.tipo = 'transferencia' then
    update public.bancas set saldo = saldo - new.monto where id = new.banca_origen_id;
    update public.bancas set saldo = saldo + coalesce(new.monto_destino, new.monto) where id = new.banca_destino_id;
  end if;
  return new;
end;
$$;

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

-- Asientos: protección original, sin vínculo con movimientos ni notas
drop trigger if exists trg_cambista_asientos_numerar_nota on public.cambista_asientos;
drop function if exists public.cambista_asientos_numerar_nota();

create or replace function public.cambista_asientos_proteger()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'Los asientos de la mesa de cambio no se borran: se anulan.'
      using errcode = '42501';
  end if;
  if new.cambista_id is distinct from old.cambista_id
     or new.tipo is distinct from old.tipo
     or new.monto_usd is distinct from old.monto_usd
     or new.tasa is distinct from old.tasa
     or new.fecha is distinct from old.fecha
     or new.numero is distinct from old.numero then
    raise exception 'No se puede cambiar el importe, tipo, fecha ni cambista de un asiento: anúlalo y registra otro.'
      using errcode = '42501';
  end if;
  if new.created_at is distinct from old.created_at
     or (new.registrado_por is distinct from old.registrado_por and new.registrado_por is not null) then
    raise exception 'No se puede cambiar quién registró el asiento ni cuándo.' using errcode = '42501';
  end if;
  if old.anulado and new.anulado is distinct from old.anulado then
    raise exception 'Un asiento anulado no se puede reactivar.' using errcode = '42501';
  end if;
  if old.anulado
     and (new.anulado_motivo is distinct from old.anulado_motivo
          or new.anulado_at is distinct from old.anulado_at
          or (new.anulado_por is distinct from old.anulado_por and new.anulado_por is not null)) then
    raise exception 'No se puede cambiar el motivo, la fecha ni el autor de una anulación.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

create or replace view public.cambistas_saldos
with (security_invoker = true) as
  select c.id as cambista_id,
         coalesce(sum(case when a.tipo = 'CARGO' then a.monto_usd else 0 end), 0)::numeric(14,2) as total_cargos,
         coalesce(sum(case when a.tipo = 'COBRO' then a.monto_usd else 0 end), 0)::numeric(14,2) as total_cobros,
         coalesce(sum(case when a.tipo = 'CARGO' then a.monto_usd else -a.monto_usd end), 0)::numeric(14,2) as saldo,
         count(a.id)::int as asientos
    from public.cambistas c
    left join public.cambista_asientos a on a.cambista_id = c.id and not a.anulado
   group by c.id;

revoke all on public.cambistas_saldos from public, anon, authenticated;
grant select on public.cambistas_saldos to service_role;

drop index if exists public.idx_cambista_asientos_numero_nota;
drop index if exists public.idx_cambista_asientos_movimiento_tipo;
alter table public.cambista_asientos drop constraint if exists cambista_asientos_nota_solo_notas;
alter table public.cambista_asientos drop column if exists numero_nota;
alter table public.cambista_asientos drop column if exists movimiento_id;
alter table public.cambista_asientos drop constraint if exists cambista_asientos_tipo_check;
alter table public.cambista_asientos
  add constraint cambista_asientos_tipo_check check (tipo in ('CARGO', 'COBRO'));
drop sequence if exists public.cambista_nc_numero_seq;
drop sequence if exists public.cambista_nd_numero_seq;

-- movimientos: fuera las columnas de la mesa
drop index if exists public.idx_movimientos_mesa_cambista;
alter table public.movimientos drop constraint if exists movimientos_mesa_coherente;
alter table public.movimientos drop constraint if exists movimientos_mesa_comision_modo;
alter table public.movimientos
  drop column if exists mesa_cambista_id,
  drop column if exists mesa_estado,
  drop column if exists mesa_monto_bruto,
  drop column if exists mesa_comision_modo,
  drop column if exists mesa_comision_pct,
  drop column if exists mesa_comision,
  drop column if exists mesa_completada_at,
  drop column if exists mesa_completada_por;

commit;
