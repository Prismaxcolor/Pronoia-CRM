-- =============================================================================
-- Nómina: DESEMBOLSO (pago) del préstamo o adelanto a un trabajador desde el Wallet, con comprobante opcional.
-- Diseño: docs/DISENO_nomina.md (sección «Fase 4»).
--
--   * public.nomina_prestamo_pagos : un renglón por préstamo (unique prestamo_id) con el egreso del Wallet que lo pagó
--       (movimiento_id), la cuenta, el monto en la moneda de la cuenta, el monto en USD del préstamo y, si la cuenta es en Bs,
--       la tasa (Bs por USD) que escribió quien pagó. Inmutable (trigger); el egreso sí se anula (ver nomina_prestamo_anular).
--       Mismo patrón que nomina_pagos: RLS deny-all, solo service_role.
--   * public.nomina_prestamo_pagar(prestamo, datos, usuario) : UNA transacción. Bloquea el préstamo y la cuenta, valida cuenta
--       vigente, saldo y comisión bancaria (Sí/No en cuentas Bs, igual que el pago de nómina) y crea el egreso con la
--       categoría recibida y los comprobantes recibidos. Reintentar sobre un préstamo ya pagado devuelve yaPagado = true.
--       Cuenta USD: egreso = monto del préstamo. Cuenta Bs: egreso = monto del préstamo x tasa (la tasa es obligatoria).
--       El préstamo se puede crear sin pago y pagarse después con esta misma función (préstamos anteriores a esta migración).
--   * public.nomina_prestamo_anular(prestamo, motivo, usuario) : anula el préstamo (mismas reglas de siempre: solo ACTIVO y sin
--       cuotas descontadas) y, si tenía desembolso, anula también su egreso en el Wallet (con el cargo de comisión, si lo
--       tiene) en la misma transacción, así el dinero vuelve a la cuenta. Reemplaza el UPDATE directo que hacía el backend.
--   * movimientos_nomina_proteger : se amplía para que el egreso de un desembolso (y su cargo de comisión) tampoco se pueda
--       anular ni cambiar de monto, moneda o cuentas desde el Wallet; solo anulando el préstamo. Concepto, referencia, fecha y
--       comprobantes siguen editables.
--
-- El egreso lleva solo «Préstamo PRE-0003 · desembolso» (ningún dato personal del trabajador).
-- Requisitos aplicados: migration_nomina.sql, migration_nomina_pago_wallet.sql, migration_editar_anular_transacciones.sql,
--   migration_wallet_correlativo.sql. Opcionales: migration_wallet_categorias.sql, migration_wallet_comision_bancaria.sql.
-- Migración aditiva e idempotente; no se aplica desde el código.
-- ROLLBACK: docs/migration_nomina_prestamo_desembolso_ROLLBACK.sql
-- CÓMO APLICAR: Supabase Studio -> SQL Editor, con backup previo. Orden de despliegue: migración PRIMERO, luego el código.
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.nomina_pagos') is null then
    raise exception 'Falta aplicar migration_nomina_pago_wallet.sql.';
  end if;
  if to_regclass('public.nomina_prestamos') is null then
    raise exception 'Falta aplicar migration_nomina.sql.';
  end if;
end $$;

-- 1. Desembolsos ------------------------------------------------------------------------------------------
create table if not exists public.nomina_prestamo_pagos (
  id            uuid          primary key default gen_random_uuid(),
  prestamo_id   uuid          not null references public.nomina_prestamos(id) on delete restrict,
  banca_id      uuid          not null references public.bancas(id) on delete restrict,
  movimiento_id uuid          not null references public.movimientos(id) on delete restrict,
  moneda        text          not null check (moneda in ('USD', 'VES')),
  monto         numeric(18,2) not null check (monto > 0),
  monto_usd     numeric(14,2) not null check (monto_usd > 0),
  tasa_bs       numeric(20,6) check (tasa_bs is null or tasa_bs > 0),
  fecha         date          not null,
  referencia    text          check (referencia is null or char_length(referencia) <= 50),
  pagado_por    uuid          references public.users(id) on delete set null,
  created_at    timestamptz   not null default now(),
  unique (prestamo_id),
  unique (movimiento_id),
  constraint nomina_prestamo_pagos_tasa_coherente check ((moneda = 'VES') = (tasa_bs is not null))
);

create index if not exists idx_nomina_prestamo_pagos_banca on public.nomina_prestamo_pagos (banca_id);

create or replace function public.nomina_prestamo_pagos_proteger()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'Los pagos de préstamos no se modifican ni se borran: se anula el préstamo.';
end;
$function$;

drop trigger if exists trg_nomina_prestamo_pagos_proteger on public.nomina_prestamo_pagos;
create trigger trg_nomina_prestamo_pagos_proteger
  before update or delete on public.nomina_prestamo_pagos
  for each row execute function public.nomina_prestamo_pagos_proteger();

-- 2. Guardián de movimientos: ahora también cubre los desembolsos --------------------------------------------
create or replace function public.movimientos_nomina_proteger()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if coalesce(current_setting('app.nomina_pago_rpc', true), '') = 'on' then
    return new;
  end if;
  if exists (select 1 from public.nomina_pagos p where p.movimiento_id in (old.id, coalesce(old.comision_de_id, old.id))) then
    raise exception 'Este movimiento es el pago de una nómina: se anula anulando la nómina (no se pueden cambiar su anulación, importes ni cuentas desde el Wallet).';
  end if;
  if exists (select 1 from public.nomina_prestamo_pagos p where p.movimiento_id in (old.id, coalesce(old.comision_de_id, old.id))) then
    raise exception 'Este movimiento es el pago de un préstamo a un trabajador: se anula anulando el préstamo (no se pueden cambiar su anulación, importes ni cuentas desde el Wallet).';
  end if;
  return new;
end;
$function$;

-- 3. Pagar (desembolsar) un préstamo ----------------------------------------------------------------------------
-- p_datos: {"bancaId":"uuid","fecha":"AAAA-MM-DD","referencia":"..."|null,"categoriaId":"uuid"|null,"tasaBs":numero|null,
--           "llevaComision":true|false|null,"comprobantes":["url",...]}
create or replace function public.nomina_prestamo_pagar(p_prestamo_id uuid, p_datos jsonb, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  c_fn_comision constant text := 'public.crear_movimiento_con_comision_bancaria(text, uuid, uuid, numeric, numeric, text, text, date, uuid, uuid, uuid)';
  v_p          public.nomina_prestamos%rowtype;
  v_fecha      date := nullif(p_datos->>'fecha', '')::date;
  v_hoy_real   date := (now() at time zone 'America/Caracas')::date;
  v_ref        text := nullif(btrim(coalesce(p_datos->>'referencia', '')), '');
  v_cat        uuid := nullif(p_datos->>'categoriaId', '')::uuid;
  v_banca      uuid := nullif(p_datos->>'bancaId', '')::uuid;
  v_tasa       numeric := nullif(p_datos->>'tasaBs', '')::numeric;
  v_lleva      boolean := case when jsonb_typeof(p_datos->'llevaComision') = 'boolean' then (p_datos->>'llevaComision')::boolean end;
  v_comp       text[] := '{}';
  v_nom_b      text;
  v_mon_b      text;
  v_sal_b      numeric;
  v_arch_b     boolean;
  v_monto      numeric;
  v_comision   numeric;
  v_com_id     uuid;
  v_mov_id     uuid;
  v_num        bigint;
  v_desc       text;
  v_r          jsonb;
begin
  if p_usuario is null then raise exception 'Falta el usuario que registra el pago.'; end if;
  select * into v_p from public.nomina_prestamos where id = p_prestamo_id for update;
  if not found then
    raise exception 'Préstamo no encontrado.' using errcode = 'P0002';
  end if;
  if v_p.estado = 'ANULADO' then raise exception 'No se puede registrar el pago de un préstamo anulado.'; end if;
  if exists (select 1 from public.nomina_prestamo_pagos where prestamo_id = v_p.id) then
    return jsonb_build_object('yaPagado', true);
  end if;

  if v_fecha is null then raise exception 'La fecha del pago es obligatoria.'; end if;
  if v_fecha > v_hoy_real + 1 then raise exception 'La fecha del pago no puede ser posterior a mañana.'; end if;
  if v_banca is null then raise exception 'Elige la cuenta desde la que se paga.'; end if;
  if jsonb_typeof(p_datos->'comprobantes') = 'array' then
    select coalesce(array_agg(e), '{}') into v_comp from jsonb_array_elements_text(p_datos->'comprobantes') e;
    if cardinality(v_comp) > 10 then raise exception 'Máximo 10 comprobantes.'; end if;
  end if;

  -- Bloquea la cuenta antes de leer su saldo.
  perform 1 from public.bancas where id = v_banca for update;
  select nombre, moneda, saldo, archivada into v_nom_b, v_mon_b, v_sal_b, v_arch_b from public.bancas where id = v_banca;
  if v_nom_b is null then raise exception 'La cuenta elegida no existe.'; end if;
  if v_arch_b then raise exception 'La cuenta % está archivada.', v_nom_b; end if;

  if v_mon_b = 'VES' then
    if v_tasa is null or v_tasa <= 0 then raise exception 'Indica la tasa (Bs por USD) para pagar desde una cuenta en bolívares.'; end if;
    v_monto := round(v_p.monto_usd * v_tasa, 2);
  elsif v_mon_b = 'USD' then
    v_tasa := null;
    v_monto := v_p.monto_usd;
  else
    raise exception 'La cuenta % es en %: el préstamo solo se paga desde una cuenta en USD o en bolívares.', v_nom_b, v_mon_b;
  end if;
  if v_monto <= 0 then raise exception 'El monto a pagar es demasiado pequeño.'; end if;

  v_desc := case v_p.tipo when 'ADELANTO' then 'Adelanto' else 'Préstamo' end
    || ' PRE-' || lpad(v_p.numero::text, 4, '0') || ' · desembolso';

  v_comision := null;
  v_com_id := null;
  if v_mon_b = 'VES' and v_lleva is true then
    if to_regprocedure(c_fn_comision) is null then
      raise exception 'La comisión bancaria aún no está habilitada en la base de datos (falta aplicar migration_wallet_comision_bancaria.sql).';
    end if;
    v_r := public.crear_movimiento_con_comision_bancaria(
      'egreso', v_banca, null, v_monto, null, v_desc, v_ref, v_fecha, null, null, p_usuario);
    v_mov_id := (v_r->>'movimientoId')::uuid;
    v_num := (v_r->>'numeroSistema')::bigint;
    v_comision := (v_r->>'comision')::numeric;
    v_com_id := (v_r->>'comisionId')::uuid;
  else
    if v_mon_b = 'VES' and v_lleva is null and to_regprocedure(c_fn_comision) is not null then
      raise exception 'Indica si el pago en bolívares lleva comisión bancaria.';
    end if;
    if v_sal_b < v_monto then
      raise exception 'Saldo insuficiente en %: disponible %, se necesita %.', v_nom_b, round(v_sal_b, 2), v_monto;
    end if;
    insert into public.movimientos (tipo, monto, moneda, descripcion, banca_origen_id, fecha, referencia, registrado_por)
    values ('egreso', v_monto, v_mon_b, v_desc, v_banca, v_fecha, v_ref, p_usuario)
    returning id, numero_sistema into v_mov_id, v_num;
  end if;

  if v_cat is not null then
    update public.movimientos set categoria_id = v_cat where id = v_mov_id;
    if v_com_id is not null then
      update public.movimientos set categoria_id = v_cat where id = v_com_id;
    end if;
  end if;
  if cardinality(v_comp) > 0 then
    update public.movimientos set comprobantes = to_jsonb(v_comp) where id = v_mov_id;
  end if;

  insert into public.nomina_prestamo_pagos (prestamo_id, banca_id, movimiento_id, moneda, monto, monto_usd, tasa_bs, fecha, referencia, pagado_por)
  values (v_p.id, v_banca, v_mov_id, v_mon_b, v_monto, v_p.monto_usd, v_tasa, v_fecha, v_ref, p_usuario);

  return jsonb_build_object(
    'yaPagado', false, 'movimientoId', v_mov_id, 'numeroSistema', v_num, 'monto', v_monto, 'moneda', v_mon_b,
    'comision', v_comision, 'comisionId', v_com_id, 'sinComision', (v_mon_b = 'VES' and v_lleva is false));
end;
$function$;

-- 4. Anular el préstamo: también anula su egreso del Wallet -------------------------------------------------------
create or replace function public.nomina_prestamo_anular(p_prestamo_id uuid, p_motivo text, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_p public.nomina_prestamos%rowtype;
  v_mov uuid;
  v_con_comision boolean;
  v_motivo_pago text;
begin
  select * into v_p from public.nomina_prestamos where id = p_prestamo_id for update;
  if not found then
    raise exception 'Préstamo no encontrado.' using errcode = 'P0002';
  end if;
  if v_p.estado = 'ANULADO' then
    return jsonb_build_object('yaAnulado', true);
  end if;
  if v_p.estado <> 'ACTIVO' then
    raise exception 'El préstamo ya está pagado o anulado.';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'El motivo de la anulación es obligatorio.';
  end if;

  -- El trigger de préstamos rechaza la anulación si ya hay cuotas descontadas (saldo distinto del monto).
  update public.nomina_prestamos
     set estado = 'ANULADO', anulado_motivo = btrim(p_motivo), anulado_at = now(), anulado_por = p_usuario, updated_at = now()
   where id = v_p.id;

  -- Wallet: si el préstamo se pagó desde una cuenta, se anula el egreso (y su cargo de comisión) para devolver el dinero.
  select pp.movimiento_id, m.comision_bancaria is not null into v_mov, v_con_comision
    from public.nomina_prestamo_pagos pp join public.movimientos m on m.id = pp.movimiento_id
   where pp.prestamo_id = v_p.id and not m.anulado;
  if found then
    perform set_config('app.nomina_pago_rpc', 'on', true);
    v_motivo_pago := 'Préstamo PRE-' || lpad(v_p.numero::text, 4, '0') || ' anulado: ' || btrim(p_motivo);
    if v_con_comision then
      perform public.anular_movimiento_con_comision_bancaria(v_mov, v_motivo_pago, p_usuario);
    else
      perform public.anular_movimiento_banca(v_mov, v_motivo_pago, p_usuario);
    end if;
  end if;
  return jsonb_build_object('yaAnulado', false);
end;
$function$;

revoke execute on function public.nomina_prestamo_pagos_proteger() from public, anon, authenticated;
revoke execute on function public.movimientos_nomina_proteger() from public, anon, authenticated;
revoke execute on function public.nomina_prestamo_pagar(uuid, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.nomina_prestamo_anular(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.nomina_prestamo_pagar(uuid, jsonb, uuid) to service_role;
grant execute on function public.nomina_prestamo_anular(uuid, text, uuid) to service_role;

-- 5. RLS: deny-all para anon/authenticated (service_role bypassa RLS) -----------------------------------------
alter table public.nomina_prestamo_pagos enable row level security;
revoke all on public.nomina_prestamo_pagos from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'nomina_prestamo_pagos' and policyname = 'nomina_prestamo_pagos_deny_anon'
  ) then
    create policy nomina_prestamo_pagos_deny_anon
      on public.nomina_prestamo_pagos for all to anon, authenticated using (false) with check (false);
  end if;
end $$;

commit;

-- Que PostgREST vea de inmediato la tabla y las funciones nuevas (sin esperar a su recarga automática).
notify pgrst, 'reload schema';

-- Verificación a mano (solo lectura, después de aplicar):
--   -- préstamos con su desembolso (los anteriores a esta migración salen sin pago hasta que se registre):
--   select p.numero, p.estado, pp.moneda, pp.monto, pp.tasa_bs, m.numero_sistema, m.anulado, cardinality(m.comprobantes) as comprobantes
--     from public.nomina_prestamos p
--     left join public.nomina_prestamo_pagos pp on pp.prestamo_id = p.id
--     left join public.movimientos m on m.id = pp.movimiento_id
--    order by p.numero desc limit 20;
--   -- préstamos anulados con un egreso todavía vigente (debe dar 0 filas):
--   select p.numero from public.nomina_prestamos p join public.nomina_prestamo_pagos pp on pp.prestamo_id = p.id
--     join public.movimientos m on m.id = pp.movimiento_id where p.estado = 'ANULADO' and not m.anulado;
