-- =============================================================================
-- Mesa de cambio, parte 5: la comisión de la mesa (a) se llama "Comisión % por cambio de divisas" y (b) queda como
-- ASIENTO en el estado de cuenta del cambista, que SÍ mueve su saldo.
-- Requisito: migration_mesa_cambio_comision_movimiento.sql (y las anteriores de la mesa). NO edita ninguna migración previa.
--
-- 1. Categoría de Wallet: la existente "Comisión cambio de divisas" se RENOMBRA a "Comisión % por cambio de divisas"
--    (mismo id: los egresos ya categorizados la siguen usando). No duplica: si ya existe una categoría con el nombre
--    nuevo en el mismo padre, no se renombra; si no existe ninguna de las dos, se crea la nueva bajo GASTOS FINANCIEROS.
--
-- 2. Asiento COMISION en cambista_asientos (tipo nuevo, solo lo crea la RPC; no se registra a mano):
--    * Cuando el cobro COMPLETA una transferencia con comisión > 0, cobrar_transferencia_mesa_cambio inserta, además del
--      egreso de Wallet, un asiento COMISION por la comisión en USD (proporcional al CARGO: cargo x comisión / bruto,
--      a centavos; si redondea a 0 no se crea). Es "un gasto por la comisión a favor del cambista": REDUCE el saldo igual
--      que un COBRO o una N/C, o sea AUMENTA lo que se le debe al cambista (saldo > 0 = nos debe; < 0 = se le debe).
--    * anular_transferencia_mesa_cambio NO cambia: ya anula todos los asientos con movimiento_id de la transferencia,
--      también el de comisión (y el protector de asientos permite esa anulación porque la hace la RPC).
--    * Un COMISION por transferencia (el índice único (movimiento_id, tipo) ya lo garantiza: solo excluye COBRO).
--    * La vista cambistas_saldos cuenta COMISION en total_cobros; su saldo ya lo restaba (todo lo que no es CARGO/ND resta).
--
-- 3. Las transferencias YA completadas antes de esta migración NO cambian de saldo (no se hace backfill aquí). Si se
--    quisiera, existe un script aparte y opcional: docs/migration_mesa_cambio_comision_asiento_BACKFILL_OPCIONAL.sql.
--    Para esas, y para las que aún están en cobro parcial, el estado de cuenta sigue mostrando la comisión como dato
--    informativo bajo el CARGO (sin mover saldo); en las transferencias con asiento COMISION esa línea ya no se muestra
--    (backend/src/utils/mesa-cambio.ts, conComisiones) para no contarla dos veces.
--
-- 4. cobrar_transferencia_mesa_cambio: base = versión vigente de migration_mesa_cambio_comision_movimiento.sql (4a);
--    cambia solo la búsqueda de la categoría (encuentra el nombre nuevo y, por seguridad, el viejo) y el INSERT del asiento.
--
-- Idempotente (IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS). Haz backup antes de aplicar. NO se aplica sola.
-- Orden: después de migration_mesa_cambio_comision_movimiento.sql (y su guardián). Hasta aplicarla, el backend funciona
-- igual que antes (el estado de cuenta solo informa la comisión).
-- ROLLBACK: docs/migration_mesa_cambio_comision_asiento_ROLLBACK.sql.
-- =============================================================================

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'movimientos' and column_name = 'mesa_comision_de_id') then
    raise exception 'Falta migration_mesa_cambio_comision_movimiento.sql: aplícala antes.';
  end if;
end $$;

-- 1. Categoría ------------------------------------------------------------------------
do $$
declare
  c_nuevo constant text := 'Comisión % por cambio de divisas';
  c_viejo constant text := 'comision cambio de divisas';
  c_nuevo_norm constant text := 'comision % por cambio de divisas';
  v_id    uuid;
  v_padre uuid;
begin
  select id, padre_id into v_id, v_padre
    from public.categorias_wallet
   where translate(lower(btrim(nombre)), 'áéíóú', 'aeiou') = c_viejo
   order by created_at
   limit 1;

  if v_id is not null then
    -- Renombra solo si no hay ya una con el nombre nuevo en el mismo padre (índice único de nombre por padre).
    if not exists (
      select 1 from public.categorias_wallet
       where coalesce(padre_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_padre, '00000000-0000-0000-0000-000000000000'::uuid)
         and translate(lower(btrim(nombre)), 'áéíóú', 'aeiou') = c_nuevo_norm
    ) then
      update public.categorias_wallet set nombre = c_nuevo where id = v_id;
    end if;
    return;
  end if;

  if exists (select 1 from public.categorias_wallet where translate(lower(btrim(nombre)), 'áéíóú', 'aeiou') = c_nuevo_norm) then
    return;
  end if;

  select id into v_padre
    from public.categorias_wallet
   where upper(btrim(nombre)) = 'GASTOS FINANCIEROS' and padre_id is null and activo and tipo in ('EGRESO', 'AMBOS')
   order by created_at
   limit 1;

  insert into public.categorias_wallet (nombre, tipo, padre_id) values (c_nuevo, 'EGRESO', v_padre);
end $$;

-- 2. Tipo de asiento COMISION -----------------------------------------------------------
alter table public.cambista_asientos drop constraint if exists cambista_asientos_tipo_check;
alter table public.cambista_asientos
  add constraint cambista_asientos_tipo_check check (tipo in ('CARGO', 'COBRO', 'NC', 'ND', 'COMISION'));

-- COMISION solo nace ligado a una transferencia (la RPC); nunca como asiento manual.
alter table public.cambista_asientos drop constraint if exists cambista_asientos_comision_con_movimiento;
alter table public.cambista_asientos
  add constraint cambista_asientos_comision_con_movimiento check (tipo <> 'COMISION' or movimiento_id is not null);

create or replace view public.cambistas_saldos
with (security_invoker = true) as
  select c.id as cambista_id,
         coalesce(sum(case when a.tipo in ('CARGO', 'ND') then a.monto_usd else 0 end), 0)::numeric(14,2) as total_cargos,
         coalesce(sum(case when a.tipo in ('COBRO', 'NC', 'COMISION') then a.monto_usd else 0 end), 0)::numeric(14,2) as total_cobros,
         coalesce(sum(case when a.tipo in ('CARGO', 'ND') then a.monto_usd else -a.monto_usd end), 0)::numeric(14,2) as saldo,
         count(a.id)::int as asientos
    from public.cambistas c
    left join public.cambista_asientos a on a.cambista_id = c.id and not a.anulado
   group by c.id;

revoke all on public.cambistas_saldos from public, anon, authenticated;
grant select on public.cambistas_saldos to service_role;

-- 3. Cobrar (total o parcial). Igual que comision_movimiento (4a); el cobro que completa con comisión > 0 crea el
--    egreso de Wallet Y el asiento COMISION del cambista. ----------------------------------------------------------
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
  v_com_as_usd numeric;
  v_com_as_id  uuid;
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
    -- Acepta el nombre nuevo y, por seguridad, el viejo (si la categoría no se hubiera renombrado todavía).
    select id into v_cat from public.categorias_wallet
     where translate(lower(btrim(nombre)), 'áéíóú', 'aeiou') in ('comision % por cambio de divisas', 'comision cambio de divisas')
       and activo and tipo in ('EGRESO', 'AMBOS')
     order by (translate(lower(btrim(nombre)), 'áéíóú', 'aeiou') = 'comision % por cambio de divisas') desc, created_at
     limit 1;
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

  -- Gasto a favor del cambista por la comisión (reduce su saldo: se le debe más). Mismo reparto que el estado de
  -- cuenta (cargo x comisión / bruto, a centavos); si redondea a 0 no hay asiento (monto_usd > 0).
  if v_con_com then
    v_com_as_usd := round(v_cargo.monto_usd * v_comision / m.mesa_monto_bruto, 2);
    if v_com_as_usd > 0 then
      insert into public.cambista_asientos
        (cambista_id, tipo, monto_usd, fecha, nota, referencia, registrado_por, movimiento_id)
      values
        (m.mesa_cambista_id, 'COMISION', v_com_as_usd, v_dia,
         'Comisión de la mesa — transferencia ' || btrim(v_mv) || ' (' || v_mon_d || ' ' || v_comision || ')',
         m.referencia, p_usuario, m.id)
      returning id into v_com_as_id;
    end if;
  end if;

  return jsonb_build_object(
    'movimientoId', m.id, 'yaCompletada', false, 'completada', v_completa, 'montoAcreditado', v_cobro,
    'montoCobrado', v_nuevo, 'montoPendiente', round(v_neto - v_nuevo, 2), 'montoUsd', v_usd,
    'comision', v_comision, 'asientoId', v_as_id, 'comisionMovimientoId', v_com_id,
    'comisionAsientoId', v_com_as_id, 'comisionAsientoUsd', v_com_as_usd);
end;
$$;

revoke execute on function public.cobrar_transferencia_mesa_cambio(uuid, numeric, numeric, uuid) from public, anon, authenticated;
grant execute on function public.cobrar_transferencia_mesa_cambio(uuid, numeric, numeric, uuid) to service_role;

commit;

-- Recarga el esquema de PostgREST.
notify pgrst, 'reload schema';

-- Verificación a mano (solo lectura, después de aplicar):
--   -- La categoría quedó con el nombre nuevo y sin duplicados (debe dar 1 fila):
--   select id, nombre, padre_id from public.categorias_wallet
--    where translate(lower(btrim(nombre)), 'áéíóú', 'aeiou') like 'comision%cambio de divisas';
--   -- Transferencias completadas con comisión que aún no tienen asiento (históricas; ver el BACKFILL opcional):
--   select m.id, m.numero_sistema, m.mesa_comision from public.movimientos m
--    where m.mesa_estado = 'completada' and not m.anulado and coalesce(m.mesa_comision, 0) > 0
--      and not exists (select 1 from public.cambista_asientos a where a.movimiento_id = m.id and a.tipo = 'COMISION');
