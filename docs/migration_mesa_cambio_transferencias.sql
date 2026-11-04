-- =============================================================================
-- Mesa de cambio, parte 2: transferencias de Wallet con cambista + notas N/C y N/D.
-- Diseño: docs/DISENO_mesa_cambio_transferencias.md. NO edita docs/migration_mesa_cambio.sql (ya aplicada).
--
-- 1. cambista_asientos
--    * tipo admite 'NC' (nota de crédito, reduce lo que les debemos) y 'ND' (nota de débito, lo aumenta).
--    * movimiento_id: transferencia de Wallet de la que nace el asiento (null = asiento manual).
--      Máximo un asiento por (movimiento, tipo).
--    * numero_nota: correlativo propio de las notas (NC-0001 / ND-0001), secuencias aparte de MC-.
--    * El trigger de protección suma: movimiento_id y numero_nota son inmutables y un asiento ligado a una
--      transferencia solo se anula desde las RPC de la transferencia.
--    * La vista cambistas_saldos cuenta ND como cargo y NC como cobro.
-- 2. movimientos
--    * mesa_cambista_id / mesa_estado ('en_proceso' | 'completada') / mesa_monto_bruto / mesa_comision_* /
--      mesa_completada_*: una transferencia con mesa de cambio nace EN PROCESO.
--    * aplicar_movimiento_a_saldo (trigger de INSERT): en proceso descuenta el origen y NO acredita el destino.
--    * reconciliar_saldo_banca: no cuenta el destino de una transferencia en proceso.
--    * Un trigger impide anular o cambiar importes/cuentas de estas transferencias por las RPC genéricas
--      (editar contable, anular_movimiento_banca): solo las RPC de la mesa lo permiten.
-- 3. RPC (security definer, search_path fijo, solo service_role):
--    * crear_transferencia_mesa_cambio, completar_transferencia_mesa_cambio (idempotente),
--      anular_transferencia_mesa_cambio.
--    Los comprobantes (imágenes) los adjunta el backend después con un update (el tipo de la columna
--    movimientos.comprobantes varía entre despliegues: text[] / jsonb).
--
-- Importes: crear_transferencia_mesa_cambio redondea monto y monto_destino a 2 decimales ANTES de validar y de
-- mover saldos. El equivalente en USD manual (p_monto_usd) solo se acepta si ninguna cuenta es USD.
-- aplicar_movimiento_a_saldo y reconciliar_saldo_banca se redefinen SIN `set search_path`, igual que sus
-- versiones originales (docs/supabase-schema.sql y migration_editar_anular_transacciones.sql): todo va calificado.
--
-- Comisión: reduce lo acreditado al destino (neto = bruto - comisión). Al completar, movimientos.monto_destino
-- queda en el neto; mesa_monto_bruto conserva el bruto. El asiento CARGO y el COBRO usan el importe bruto en USD.
--
-- Idempotente (IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS). No inserta datos de negocio.
-- Requisitos: migration_mesa_cambio.sql, migration_editar_anular_transacciones.sql y migration_wallet_correlativo.sql.
-- ROLLBACK: docs/migration_mesa_cambio_transferencias_ROLLBACK.sql. Hacer backup antes de aplicar.
-- El backend responde 503 en crear/completar mientras esta migración no esté aplicada.
-- =============================================================================

begin;

-- 1. cambista_asientos ---------------------------------------------------------
alter table public.cambista_asientos drop constraint if exists cambista_asientos_tipo_check;
alter table public.cambista_asientos
  add constraint cambista_asientos_tipo_check check (tipo in ('CARGO', 'COBRO', 'NC', 'ND'));

alter table public.cambista_asientos
  add column if not exists movimiento_id uuid references public.movimientos(id) on delete restrict,
  add column if not exists numero_nota   bigint;

alter table public.cambista_asientos drop constraint if exists cambista_asientos_nota_solo_notas;
alter table public.cambista_asientos
  add constraint cambista_asientos_nota_solo_notas check (numero_nota is null or tipo in ('NC', 'ND'));

create sequence if not exists public.cambista_nc_numero_seq;
create sequence if not exists public.cambista_nd_numero_seq;
revoke all on sequence public.cambista_nc_numero_seq from anon, authenticated;
revoke all on sequence public.cambista_nd_numero_seq from anon, authenticated;
grant usage on sequence public.cambista_nc_numero_seq, public.cambista_nd_numero_seq to service_role;

create unique index if not exists idx_cambista_asientos_numero_nota
  on public.cambista_asientos (tipo, numero_nota) where numero_nota is not null;
create unique index if not exists idx_cambista_asientos_movimiento_tipo
  on public.cambista_asientos (movimiento_id, tipo) where movimiento_id is not null;

create or replace function public.cambista_asientos_numerar_nota()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.numero_nota is null then
    if new.tipo = 'NC' then
      new.numero_nota := nextval('public.cambista_nc_numero_seq');
    elsif new.tipo = 'ND' then
      new.numero_nota := nextval('public.cambista_nd_numero_seq');
    end if;
  end if;
  return new;
end;
$function$;

revoke execute on function public.cambista_asientos_numerar_nota() from public, anon, authenticated;

drop trigger if exists trg_cambista_asientos_numerar_nota on public.cambista_asientos;
create trigger trg_cambista_asientos_numerar_nota
  before insert on public.cambista_asientos
  for each row execute function public.cambista_asientos_numerar_nota();

-- Protección: misma función que migration_mesa_cambio.sql más movimiento_id / numero_nota inmutables y
-- anulación de asientos ligados solo desde las RPC de la transferencia (app.mesa_cambio_rpc = 'on').
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
     or new.numero is distinct from old.numero
     or new.numero_nota is distinct from old.numero_nota
     or new.movimiento_id is distinct from old.movimiento_id then
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
  if old.movimiento_id is not null and new.anulado and not old.anulado
     and coalesce(current_setting('app.mesa_cambio_rpc', true), '') <> 'on' then
    raise exception 'Este asiento nace de una transferencia con mesa de cambio: anula o completa la transferencia desde Wallet.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

create or replace view public.cambistas_saldos
with (security_invoker = true) as
  select c.id as cambista_id,
         coalesce(sum(case when a.tipo in ('CARGO', 'ND') then a.monto_usd else 0 end), 0)::numeric(14,2) as total_cargos,
         coalesce(sum(case when a.tipo in ('COBRO', 'NC') then a.monto_usd else 0 end), 0)::numeric(14,2) as total_cobros,
         coalesce(sum(case when a.tipo in ('CARGO', 'ND') then a.monto_usd else -a.monto_usd end), 0)::numeric(14,2) as saldo,
         count(a.id)::int as asientos
    from public.cambistas c
    left join public.cambista_asientos a on a.cambista_id = c.id and not a.anulado
   group by c.id;

revoke all on public.cambistas_saldos from public, anon, authenticated;
grant select on public.cambistas_saldos to service_role;

-- 2. movimientos ---------------------------------------------------------------
alter table public.movimientos
  add column if not exists mesa_cambista_id    uuid references public.cambistas(id) on delete restrict,
  add column if not exists mesa_estado         text,
  add column if not exists mesa_monto_bruto    numeric,
  add column if not exists mesa_comision_modo  text,
  add column if not exists mesa_comision_pct   numeric,
  add column if not exists mesa_comision       numeric,
  add column if not exists mesa_completada_at  timestamptz,
  add column if not exists mesa_completada_por uuid references public.users(id) on delete set null;

alter table public.movimientos drop constraint if exists movimientos_mesa_coherente;
alter table public.movimientos add constraint movimientos_mesa_coherente check (
  (mesa_cambista_id is null and mesa_estado is null)
  or (mesa_cambista_id is not null and tipo = 'transferencia' and mesa_estado in ('en_proceso', 'completada'))
);
alter table public.movimientos drop constraint if exists movimientos_mesa_comision_modo;
alter table public.movimientos add constraint movimientos_mesa_comision_modo check (
  mesa_comision_modo is null or mesa_comision_modo in ('porcentaje', 'monto')
);

create index if not exists idx_movimientos_mesa_cambista
  on public.movimientos (mesa_cambista_id) where mesa_cambista_id is not null;

-- 2a. Trigger de saldo en INSERT: una transferencia en proceso no acredita el destino todavía.
create or replace function public.aplicar_movimiento_a_saldo()
returns trigger
language plpgsql
as $$
begin
  if new.tipo = 'ingreso' then
    update public.bancas
       set saldo = saldo + new.monto
     where id = new.banca_origen_id;

  elsif new.tipo = 'egreso' then
    update public.bancas
       set saldo = saldo - new.monto
     where id = new.banca_origen_id;

  elsif new.tipo = 'transferencia' then
    update public.bancas
       set saldo = saldo - new.monto
     where id = new.banca_origen_id;

    if new.mesa_estado is distinct from 'en_proceso' then
      update public.bancas
         set saldo = saldo + coalesce(new.monto_destino, new.monto)
       where id = new.banca_destino_id;
    end if;
  end if;

  return new;
end;
$$;

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

-- 2c. Guardián: importes, cuentas y anulación de una transferencia con mesa solo por las RPC de la mesa.
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

revoke execute on function public.movimientos_mesa_proteger() from public, anon, authenticated;

drop trigger if exists trg_movimientos_mesa_proteger on public.movimientos;
create trigger trg_movimientos_mesa_proteger
  before update on public.movimientos
  for each row
  when (old.mesa_cambista_id is not null)
  execute function public.movimientos_mesa_proteger();

-- 3. RPC -------------------------------------------------------------------------

-- 3a. Crear: transferencia EN PROCESO + asiento CARGO, en una transacción.
create or replace function public.crear_transferencia_mesa_cambio(
  p_cambista_id uuid, p_banca_origen_id uuid, p_banca_destino_id uuid,
  p_monto numeric, p_monto_destino numeric, p_monto_usd numeric,
  p_comision_modo text, p_comision_valor numeric,
  p_descripcion text, p_referencia text, p_fecha date, p_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_activo   boolean;
  v_nom_o    text;  v_mon_o text;  v_sal_o numeric;  v_arch_o boolean;
  v_nom_d    text;  v_mon_d text;  v_arch_d boolean;
  v_monto    numeric;
  v_mdest_in numeric;
  v_bruto    numeric;
  v_mdest    numeric;
  v_comision numeric := 0;
  v_pct      numeric;
  v_usd      numeric;
  v_mov_id   uuid;
  v_num      bigint;
  v_as_id    uuid;
  v_as_num   bigint;
begin
  perform set_config('app.mesa_cambio_rpc', 'on', true);

  if p_usuario is null then raise exception 'Falta el usuario que registra la transferencia.'; end if;
  -- Los importes se redondean a centavos ANTES de validar y de mover saldos: así el origen y el destino
  -- siempre se mueven por el mismo importe (0.004 no destruye saldo, 0.006 no lo crea).
  v_monto    := round(p_monto, 2);
  v_mdest_in := round(p_monto_destino, 2);
  if v_monto is null or v_monto <= 0 then raise exception 'El monto debe ser mayor a 0.'; end if;
  if p_banca_origen_id is null or p_banca_destino_id is null then
    raise exception 'Selecciona la cuenta de origen y la de destino.';
  end if;
  if p_banca_origen_id = p_banca_destino_id then
    raise exception 'La cuenta destino debe ser distinta de la de origen.';
  end if;
  if p_fecha is null then raise exception 'La fecha es obligatoria.'; end if;

  select activo into v_activo from public.cambistas where id = p_cambista_id for share;
  if not found then raise exception 'Cambista no encontrado.'; end if;
  if not v_activo then raise exception 'El cambista está inactivo: actívalo para usarlo en una transferencia.'; end if;

  perform 1 from public.bancas where id in (p_banca_origen_id, p_banca_destino_id) order by id for update;
  select nombre, moneda, saldo, archivada into v_nom_o, v_mon_o, v_sal_o, v_arch_o
    from public.bancas where id = p_banca_origen_id;
  if v_nom_o is null then raise exception 'Cuenta de origen no encontrada.'; end if;
  select nombre, moneda, archivada into v_nom_d, v_mon_d, v_arch_d
    from public.bancas where id = p_banca_destino_id;
  if v_nom_d is null then raise exception 'Cuenta de destino no encontrada.'; end if;
  if v_arch_o then raise exception 'La cuenta % está archivada.', v_nom_o; end if;
  if v_arch_d then raise exception 'La cuenta % está archivada.', v_nom_d; end if;
  if v_sal_o < v_monto then
    raise exception 'Saldo insuficiente en %: disponible %, se intentó transferir %.', v_nom_o, round(v_sal_o, 2), v_monto;
  end if;

  if v_mon_o = v_mon_d then
    v_bruto := v_monto;
    v_mdest := null;
  else
    if v_mdest_in is null or v_mdest_in <= 0 then
      raise exception 'Indica el monto que llega a la cuenta destino (monedas distintas).';
    end if;
    v_bruto := v_mdest_in;
    v_mdest := v_mdest_in;
  end if;

  if p_comision_modo is null then
    v_comision := 0;
  elsif p_comision_modo = 'porcentaje' then
    if p_comision_valor is null or p_comision_valor < 0 or p_comision_valor >= 100 then
      raise exception 'El porcentaje de comisión debe estar entre 0 y menos de 100.';
    end if;
    v_pct := p_comision_valor;
    v_comision := round(v_bruto * p_comision_valor / 100, 2);
  elsif p_comision_modo = 'monto' then
    if p_comision_valor is null or p_comision_valor < 0 then raise exception 'La comisión no puede ser negativa.'; end if;
    v_comision := round(p_comision_valor, 2);
  else
    raise exception 'Modo de comisión inválido.';
  end if;
  if v_comision >= v_bruto then
    raise exception 'La comisión debe ser menor al monto que entrega el cambista.';
  end if;

  -- El equivalente en USD manual solo se admite cuando NINGUNA cuenta es USD; si una lo es, el importe sale de ella.
  if p_monto_usd is not null and (v_mon_o = 'USD' or v_mon_d = 'USD') then
    raise exception 'No indiques el equivalente en USD: una de las cuentas ya está en USD y se usa su importe.';
  end if;
  v_usd := case when v_mon_o = 'USD' then v_monto when v_mon_d = 'USD' then v_bruto else round(p_monto_usd, 2) end;
  if v_usd is null or v_usd <= 0 then
    raise exception 'Indica el equivalente en USD de la operación: ninguna de las dos cuentas está en USD.';
  end if;

  insert into public.movimientos
    (tipo, monto, moneda, descripcion, banca_origen_id, banca_destino_id, fecha, referencia, registrado_por,
     monto_usd, monto_destino, mesa_cambista_id, mesa_estado, mesa_monto_bruto,
     mesa_comision_modo, mesa_comision_pct, mesa_comision)
  values
    ('transferencia', v_monto, v_mon_o, coalesce(btrim(p_descripcion), ''), p_banca_origen_id, p_banca_destino_id,
     p_fecha, nullif(btrim(p_referencia), ''), p_usuario,
     v_usd, v_mdest, p_cambista_id, 'en_proceso', v_bruto,
     p_comision_modo, v_pct, v_comision)
  returning id, numero_sistema into v_mov_id, v_num;

  insert into public.cambista_asientos
    (cambista_id, tipo, monto_usd, fecha, nota, referencia, registrado_por, movimiento_id)
  values
    (p_cambista_id, 'CARGO', v_usd, p_fecha,
     'Transferencia ' || coalesce('MV-' || lpad(v_num::text, 4, '0') || ' ', '') || 'en proceso',
     nullif(btrim(p_referencia), ''), p_usuario, v_mov_id)
  returning id, numero into v_as_id, v_as_num;

  return jsonb_build_object(
    'movimientoId', v_mov_id, 'numeroSistema', v_num, 'asientoId', v_as_id, 'asientoNumero', v_as_num,
    'montoUsd', v_usd, 'montoBruto', v_bruto, 'comision', v_comision, 'montoNeto', round(v_bruto - v_comision, 2));
end;
$$;

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

-- 4. Permisos: solo el backend (service_role) ejecuta las RPC ----------------------
revoke execute on function public.crear_transferencia_mesa_cambio(uuid, uuid, uuid, numeric, numeric, numeric, text, numeric, text, text, date, uuid) from public, anon, authenticated;
revoke execute on function public.completar_transferencia_mesa_cambio(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.anular_transferencia_mesa_cambio(uuid, text, uuid) from public, anon, authenticated;

grant execute on function public.crear_transferencia_mesa_cambio(uuid, uuid, uuid, numeric, numeric, numeric, text, numeric, text, text, date, uuid) to service_role;
grant execute on function public.completar_transferencia_mesa_cambio(uuid, uuid) to service_role;
grant execute on function public.anular_transferencia_mesa_cambio(uuid, text, uuid) to service_role;

commit;

-- Recarga el esquema de PostgREST (columnas y funciones nuevas visibles para el backend sin reiniciar).
notify pgrst, 'reload schema';

-- Verificación a mano (solo lectura, después de aplicar):
--   select * from public.cambistas_saldos;
--   select id, mesa_estado, mesa_monto_bruto, mesa_comision, monto_destino from public.movimientos where mesa_cambista_id is not null;
