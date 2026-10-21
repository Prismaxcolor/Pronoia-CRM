-- =============================================================================
-- Wallet: comisión bancaria del 0.3% (mínimo 14 Bs) en movimientos que debitan una cuenta en Bs.
-- Diseño: docs/DISENO_wallet_comision_equivalente.md.
--
-- Qué hace:
--  1. movimientos.comision_bancaria  -> en el movimiento PRINCIPAL: comisión (Bs) cargada junto a él (null = sin comisión).
--     movimientos.comision_de_id     -> en el CARGO de la comisión (un egreso en la misma cuenta): id del principal.
--     Un principal tiene como máximo un cargo (índice único parcial). El cargo nace en la MISMA transacción.
--  2. Guardián (trigger BEFORE UPDATE): un movimiento con comisión (principal o cargo) no puede anularse ni cambiar
--     importes/cuentas por las RPC genéricas (anular_movimiento_banca, editar contable): solo por las RPC de abajo.
--     Así nunca queda un movimiento sin su comisión ni al revés. Concepto, referencia, fecha y comprobantes siguen editables.
--  3. RPC (security definer, search_path fijo, solo service_role):
--     * crear_movimiento_con_comision_bancaria: egreso o transferencia desde una cuenta VES + su cargo de comisión.
--       comisión = greatest(round(monto * 0.003, 2), 14)  (espejo de shared/types/comision-bancaria.ts).
--       Valida cuentas, moneda VES y saldo suficiente para monto + comisión.
--     * anular_movimiento_con_comision_bancaria: anula el cargo y el movimiento principal juntos (motivo obligatorio).
--
-- NO aplica a pagos/cobros del estado de cuenta ni a las transferencias con mesa de cambio (tienen su propia ruta).
-- El cargo de comisión es un egreso manual más: recibe su correlativo MV- como cualquier movimiento manual.
-- Los comprobantes (imágenes) los adjunta el backend después con un update (el tipo de la columna varía entre despliegues).
--
-- DUDA DOCUMENTADA (movimientos.tipo): la tabla base `movimientos` es preexistente y ninguna migración de docs/
-- define si `tipo` es enum o text con check. Por eso la RPC guarda p_tipo en una variable `movimientos.tipo%type`
-- (la asignación plpgsql convierte text -> enum o text sin error) y el cargo usa el literal 'egreso'. Verificar en
-- staging: select data_type, udt_name from information_schema.columns where table_name='movimientos' and column_name='tipo';
-- Categorías (migration_wallet_categorias.sql): la RPC NO inserta categoria_id; el backend la aplica con un update
-- posterior (aplicarCategoriaSiFalta). El guardián de arriba no revisa categoria_id, así que ese update no se bloquea,
-- y el trigger de categorías la valida (tipo compatible; las transferencias no llevan categoría).
--
-- Idempotente (IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS). No inserta ni modifica datos de negocio.
-- Requisitos: migration_editar_anular_transacciones.sql y migration_wallet_correlativo.sql.
-- ROLLBACK: docs/migration_wallet_comision_bancaria_ROLLBACK.sql. Hacer backup antes de aplicar. NO se aplica sola.
-- Mientras no esté aplicada, el backend registra los movimientos como siempre y el formulario no ofrece la comisión.
-- =============================================================================

begin;

-- 1. Columnas ---------------------------------------------------------------------
alter table public.movimientos
  add column if not exists comision_bancaria numeric,
  add column if not exists comision_de_id    uuid references public.movimientos(id) on delete restrict;

alter table public.movimientos drop constraint if exists movimientos_comision_coherente;
alter table public.movimientos add constraint movimientos_comision_coherente check (
  (comision_bancaria is null or comision_bancaria > 0)
  and (comision_de_id is null or (comision_bancaria is null and comision_de_id <> id and tipo = 'egreso'))
);

create unique index if not exists idx_movimientos_comision_de
  on public.movimientos (comision_de_id) where comision_de_id is not null;

-- 2. Guardián -----------------------------------------------------------------------
create or replace function public.movimientos_comision_proteger()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if coalesce(current_setting('app.comision_bancaria_rpc', true), '') = 'on' then
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
     or new.comision_bancaria is distinct from old.comision_bancaria
     or new.comision_de_id is distinct from old.comision_de_id then
    raise exception 'Este movimiento lleva comisión bancaria: se anula desde su detalle en Wallet (se anula junto con su comisión); no se pueden cambiar sus importes ni sus cuentas.';
  end if;
  return new;
end;
$function$;

revoke execute on function public.movimientos_comision_proteger() from public, anon, authenticated;

drop trigger if exists trg_movimientos_comision_proteger on public.movimientos;
create trigger trg_movimientos_comision_proteger
  before update on public.movimientos
  for each row
  when (old.comision_bancaria is not null or old.comision_de_id is not null)
  execute function public.movimientos_comision_proteger();

-- 3a. Crear: movimiento + cargo de comisión, en una transacción ------------------------
create or replace function public.crear_movimiento_con_comision_bancaria(
  p_tipo text, p_banca_origen_id uuid, p_banca_destino_id uuid,
  p_monto numeric, p_monto_destino numeric,
  p_descripcion text, p_referencia text, p_fecha date,
  p_proveedor_id uuid, p_cliente_id uuid, p_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_tasa     constant numeric := 0.003;  -- 0.3 %
  c_minimo   constant numeric := 14;     -- Bs
  v_nom_o    text;  v_mon_o text;  v_sal_o numeric;  v_arch_o boolean;
  v_nom_d    text;  v_mon_d text;  v_arch_d boolean;
  v_dest     uuid;
  v_mdest    numeric;
  v_comision numeric;
  v_mov_id   uuid;
  v_num      bigint;
  v_com_id   uuid;
  v_ref      text := nullif(btrim(p_referencia), '');
  -- Tipo con el tipo real de la columna (text con check o enum): la asignación plpgsql convierte desde text.
  v_tipo     public.movimientos.tipo%type;
begin
  if p_usuario is null then raise exception 'Falta el usuario que registra el movimiento.'; end if;
  if p_tipo is null or p_tipo not in ('egreso', 'transferencia') then
    raise exception 'La comisión bancaria solo aplica a egresos y transferencias.';
  end if;
  if p_monto is null or p_monto <= 0 then raise exception 'El monto debe ser mayor a 0.'; end if;
  if p_banca_origen_id is null then raise exception 'Selecciona la cuenta de origen.'; end if;
  if p_fecha is null then raise exception 'La fecha es obligatoria.'; end if;

  v_tipo := p_tipo;
  v_dest := case when p_tipo = 'transferencia' then p_banca_destino_id else null end;
  if p_tipo = 'transferencia' then
    if v_dest is null then raise exception 'Selecciona la cuenta de destino.'; end if;
    if v_dest = p_banca_origen_id then raise exception 'La cuenta destino debe ser distinta de la de origen.'; end if;
  end if;

  perform 1 from public.bancas where id in (p_banca_origen_id, coalesce(v_dest, p_banca_origen_id)) order by id for update;
  select nombre, moneda, saldo, archivada into v_nom_o, v_mon_o, v_sal_o, v_arch_o
    from public.bancas where id = p_banca_origen_id;
  if v_nom_o is null then raise exception 'Cuenta de origen no encontrada.'; end if;
  if v_arch_o then raise exception 'La cuenta % está archivada.', v_nom_o; end if;
  if v_mon_o <> 'VES' then
    raise exception 'La comisión bancaria solo aplica cuando la cuenta de origen está en bolívares (Bs).';
  end if;

  if v_dest is not null then
    select nombre, moneda, archivada into v_nom_d, v_mon_d, v_arch_d from public.bancas where id = v_dest;
    if v_nom_d is null then raise exception 'Cuenta de destino no encontrada.'; end if;
    if v_arch_d then raise exception 'La cuenta % está archivada.', v_nom_d; end if;
    if v_mon_d <> v_mon_o then
      if p_monto_destino is null or p_monto_destino <= 0 then
        raise exception 'Indica el monto que llega a la cuenta destino (monedas distintas).';
      end if;
      v_mdest := p_monto_destino;
    end if;
  end if;

  v_comision := greatest(round(p_monto * c_tasa, 2), c_minimo);
  if v_sal_o < p_monto + v_comision then
    raise exception 'Saldo insuficiente en %: disponible %, se necesita % (monto % + comisión bancaria %).',
      v_nom_o, round(v_sal_o, 2), round(p_monto + v_comision, 2), round(p_monto, 2), v_comision;
  end if;

  insert into public.movimientos
    (tipo, monto, moneda, descripcion, banca_origen_id, banca_destino_id, fecha, referencia, registrado_por,
     proveedor_id, cliente_id, monto_destino, comision_bancaria)
  values
    (v_tipo, p_monto, v_mon_o, coalesce(btrim(p_descripcion), ''), p_banca_origen_id, v_dest, p_fecha, v_ref, p_usuario,
     p_proveedor_id, p_cliente_id, v_mdest, v_comision)
  returning id, numero_sistema into v_mov_id, v_num;

  insert into public.movimientos
    (tipo, monto, moneda, descripcion, banca_origen_id, fecha, referencia, registrado_por, comision_de_id)
  values
    ('egreso', v_comision, v_mon_o,
     'Comisión bancaria 0.3%' || coalesce(' – MV-' || lpad(v_num::text, 4, '0'), ''),
     p_banca_origen_id, p_fecha, v_ref, p_usuario, v_mov_id)
  returning id into v_com_id;

  return jsonb_build_object(
    'movimientoId', v_mov_id, 'numeroSistema', v_num, 'comisionId', v_com_id,
    'comision', v_comision, 'totalDebitado', round(p_monto + v_comision, 2));
end;
$$;

-- 3b. Anular: el cargo de la comisión y el movimiento principal, juntos ---------------------
create or replace function public.anular_movimiento_con_comision_bancaria(p_id uuid, p_motivo text, p_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m     public.movimientos;
  v_com uuid;
begin
  perform set_config('app.comision_bancaria_rpc', 'on', true);
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'El motivo de la anulación es obligatorio.'; end if;

  select * into m from public.movimientos where id = p_id for update;
  if not found then raise exception 'Movimiento no encontrado.'; end if;
  if m.comision_bancaria is null then raise exception 'Este movimiento no lleva comisión bancaria.'; end if;

  select id into v_com from public.movimientos where comision_de_id = p_id and not anulado for update;
  if v_com is not null then
    perform public.anular_movimiento_banca(v_com, 'Comisión de un movimiento anulado: ' || btrim(p_motivo), p_usuario);
  end if;
  perform public.anular_movimiento_banca(p_id, p_motivo, p_usuario);

  return jsonb_build_object('movimientoId', p_id, 'comisionId', v_com, 'tipo', m.tipo, 'monto', m.monto, 'moneda', m.moneda);
end;
$$;

-- 4. Permisos: solo el backend (service_role) ejecuta las RPC -------------------------------
revoke execute on function public.crear_movimiento_con_comision_bancaria(text, uuid, uuid, numeric, numeric, text, text, date, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.anular_movimiento_con_comision_bancaria(uuid, text, uuid) from public, anon, authenticated;

grant execute on function public.crear_movimiento_con_comision_bancaria(text, uuid, uuid, numeric, numeric, text, text, date, uuid, uuid, uuid) to service_role;
grant execute on function public.anular_movimiento_con_comision_bancaria(uuid, text, uuid) to service_role;

commit;

-- Recarga el esquema de PostgREST (columnas y funciones nuevas visibles para el backend sin reiniciar).
notify pgrst, 'reload schema';

-- Verificación a mano (solo lectura, después de aplicar):
--   select m.numero_sistema, m.monto, m.comision_bancaria, c.numero_sistema as num_cargo, c.monto as cargo, c.descripcion
--     from public.movimientos m join public.movimientos c on c.comision_de_id = m.id order by m.creado_en desc limit 10;
--   -- principales con comisión sin su cargo vigente (debe dar 0 filas, salvo anulados):
--   select m.id from public.movimientos m
--    where m.comision_bancaria is not null and not m.anulado
--      and not exists (select 1 from public.movimientos c where c.comision_de_id = m.id and not c.anulado);
