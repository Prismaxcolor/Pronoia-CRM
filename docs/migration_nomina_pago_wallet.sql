-- =============================================================================
-- Nómina, fase 2: pagar una nómina CERRADA desde el Wallet, con la categoría de gasto del tipo de personal.
-- Diseño: docs/DISENO_nomina.md (sección "Fase 2").
--
--   * public.nomina_pagos : un renglón por (nómina, moneda de pago) con el egreso del Wallet que lo pagó
--       (movimiento_id), la cuenta, el monto (en la moneda de la cuenta) y su equivalente en USD. Inmutable: no se
--       modifica ni se borra (el egreso, sí, se anula; ver más abajo).
--       unique (nomina_id, moneda_pago) => una nómina nunca se paga dos veces; unique (movimiento_id).
--   * public.nomina_pagar(nomina, datos, usuario) : UNA transacción. Bloquea la nómina, comprueba que esté CERRADA y sin
--       pagar, y crea 1 o 2 egresos (divisas en una cuenta USD, bolívares en una cuenta VES) con la categoría recibida.
--       Si la cuenta es VES y la persona eligió comisión bancaria, reutiliza la RPC existente
--       crear_movimiento_con_comision_bancaria (0.3 %, mínimo 14 Bs; el cargo nace en la misma transacción). Sin
--       comisión inserta el egreso igual que el Wallet manual (los triggers existentes ajustan el saldo y numeran MV-).
--       Reintentar sobre una nómina ya pagada no hace nada y devuelve yaPagada = true.
--   * public.nomina_anular (reemplaza a la de migration_nomina.sql): si la nómina cerrada está pagada, anula también sus
--       egresos (con el cargo de comisión, si lo tiene) usando las funciones de anulación del Wallet, así los saldos de
--       las cuentas vuelven a lo que eran. Todo en la misma transacción que devuelve las cuotas de préstamo.
--   * Guardián sobre movimientos: un egreso de nómina (o su cargo de comisión) no puede anularse ni cambiar de monto,
--       cuenta o moneda desde el Wallet; solo se anula anulando la nómina. Concepto, referencia, fecha y comprobantes
--       siguen editables.
--
-- No toca la categoría de los movimientos más allá de aplicar la recibida (el trigger movimientos_validar_categoria la valida).
-- Requisitos aplicados: migration_nomina.sql, migration_editar_anular_transacciones.sql, migration_wallet_correlativo.sql.
-- Opcionales (sin ellos la función sigue andando salvo en lo que se indica): migration_wallet_categorias.sql (categoría),
-- migration_wallet_comision_bancaria.sql (comisión bancaria; sin ella una cuenta en Bs se paga sin comisión).
--
-- Seguridad: RLS activado y deny-all para anon/authenticated; solo el backend Express (service_role) ejecuta las funciones
-- (search_path vacío). El egreso lleva solo "Nómina NOM-000X · tipo · semana": ningún dato personal del trabajador.
--
-- Migración aditiva e idempotente; no se aplica desde el código.
-- ROLLBACK: docs/migration_nomina_pago_wallet_ROLLBACK.sql
-- CÓMO APLICAR: Supabase Studio -> SQL Editor, con backup previo.
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.nominas') is null then
    raise exception 'Falta aplicar migration_nomina.sql.';
  end if;
  if to_regprocedure('public.anular_movimiento_banca(uuid, text, uuid)') is null then
    raise exception 'Falta aplicar migration_editar_anular_transacciones.sql.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'movimientos' and column_name = 'numero_sistema') then
    raise exception 'Falta aplicar migration_wallet_correlativo.sql.';
  end if;
end $$;

-- 1. Pagos de nómina ----------------------------------------------------------------------
create table if not exists public.nomina_pagos (
  id           uuid          primary key default gen_random_uuid(),
  nomina_id    uuid          not null references public.nominas(id) on delete restrict,
  moneda_pago  text          not null check (moneda_pago in ('USD', 'BS')),
  banca_id     uuid          not null references public.bancas(id) on delete restrict,
  movimiento_id uuid         not null references public.movimientos(id) on delete restrict,
  monto        numeric(18,2) not null check (monto > 0),
  monto_usd    numeric(16,2) not null check (monto_usd > 0),
  cantidad     integer       not null check (cantidad > 0),
  fecha        date          not null,
  referencia   text          check (referencia is null or char_length(referencia) <= 50),
  pagado_por   uuid          references public.users(id) on delete set null,
  created_at   timestamptz   not null default now(),
  unique (nomina_id, moneda_pago),
  unique (movimiento_id)
);

create index if not exists idx_nomina_pagos_banca on public.nomina_pagos (banca_id);

-- 2. Triggers de protección ------------------------------------------------------------------
create or replace function public.nomina_pagos_proteger()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'Los pagos de nómina no se modifican ni se borran: se anula la nómina.';
end;
$function$;

drop trigger if exists trg_nomina_pagos_proteger on public.nomina_pagos;
create trigger trg_nomina_pagos_proteger
  before update or delete on public.nomina_pagos
  for each row execute function public.nomina_pagos_proteger();

-- Guardián: el egreso de una nómina pagada (y su cargo de comisión) solo se anula o cambia de importes desde nomina_anular.
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
  return new;
end;
$function$;

drop trigger if exists trg_movimientos_nomina_proteger on public.movimientos;
create trigger trg_movimientos_nomina_proteger
  before update on public.movimientos
  for each row
  when (new.anulado is distinct from old.anulado
     or new.tipo is distinct from old.tipo
     or new.monto is distinct from old.monto
     or new.moneda is distinct from old.moneda
     or new.monto_usd is distinct from old.monto_usd
     or new.banca_origen_id is distinct from old.banca_origen_id
     or new.banca_destino_id is distinct from old.banca_destino_id)
  execute function public.movimientos_nomina_proteger();

-- 3. Pagar -------------------------------------------------------------------------------------
-- p_datos: {"fecha":"AAAA-MM-DD","referencia":"..."|null,"categoriaId":"uuid"|null,
--           "pagos":[{"moneda":"USD"|"BS","bancaId":"uuid","llevaComision":true|false|null}]}
-- Debe haber un pago por cada moneda que tenga montos a pagar en la nómina, y ninguno más.
create or replace function public.nomina_pagar(p_nomina_id uuid, p_datos jsonb, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  c_fn_comision constant text := 'public.crear_movimiento_con_comision_bancaria(text, uuid, uuid, numeric, numeric, text, text, date, uuid, uuid, uuid)';
  v_n          public.nominas%rowtype;
  v_fecha      date := nullif(p_datos->>'fecha', '')::date;
  v_ref        text := nullif(btrim(coalesce(p_datos->>'referencia', '')), '');
  v_cat        uuid := nullif(p_datos->>'categoriaId', '')::uuid;
  v_pagos      jsonb := p_datos->'pagos';
  v_p          jsonb;
  v_moneda     text;
  v_banca      uuid;
  v_lleva      boolean;
  v_monto      numeric;
  v_monto_usd  numeric;
  v_cant       integer;
  v_nom_b      text;
  v_mon_b      text;
  v_mon_esperada text;
  v_sal_b      numeric;
  v_arch_b     boolean;
  v_comision   numeric;
  v_com_id     uuid;
  v_mov_id     uuid;
  v_num        bigint;
  v_desc       text;
  v_r          jsonb;
  v_res        jsonb := '[]'::jsonb;
  v_requeridas text[];
  v_enviadas   text[];
begin
  if p_usuario is null then raise exception 'Falta el usuario que registra el pago.'; end if;
  select * into v_n from public.nominas where id = p_nomina_id for update;
  if not found then
    raise exception 'Nómina no encontrada.' using errcode = 'P0002';
  end if;
  if v_n.estado = 'ANULADA' then raise exception 'No se puede pagar una nómina anulada.'; end if;
  if v_n.estado <> 'CERRADA' then raise exception 'Solo se puede pagar una nómina cerrada: ciérrala primero.'; end if;
  if exists (select 1 from public.nomina_pagos where nomina_id = v_n.id) then
    return jsonb_build_object('yaPagada', true);
  end if;

  if v_fecha is null then raise exception 'La fecha del pago es obligatoria.'; end if;
  if v_fecha > (now() at time zone 'America/Caracas')::date + 1 then raise exception 'La fecha del pago no puede ser posterior a mañana.'; end if;
  if v_fecha < v_n.semana_inicio then raise exception 'La fecha del pago no puede ser anterior a la semana de la nómina.'; end if;
  if jsonb_typeof(v_pagos) is distinct from 'array' or jsonb_array_length(v_pagos) = 0 then
    raise exception 'Elige la cuenta desde la que se paga.';
  end if;

  -- Monedas con algo que pagar (la BD es la autoridad: se calcula de los renglones, no de lo que mande el navegador).
  select coalesce(array_agg(m order by m), '{}') into v_requeridas from (
    select 'USD' as m from public.nomina_lineas where nomina_id = v_n.id and moneda_pago = 'USD' having coalesce(sum(total_usd), 0) > 0
    union all
    select 'BS' from public.nomina_lineas where nomina_id = v_n.id and moneda_pago = 'BS' having coalesce(sum(total_bs), 0) > 0
  ) x;
  if coalesce(array_length(v_requeridas, 1), 0) = 0 then raise exception 'La nómina no tiene montos por pagar.'; end if;
  select coalesce(array_agg(e->>'moneda' order by e->>'moneda'), '{}') into v_enviadas from jsonb_array_elements(v_pagos) e;
  if v_enviadas is distinct from v_requeridas then
    raise exception 'Elige una cuenta para cada moneda a pagar (%).', array_to_string(v_requeridas, ' y ');
  end if;

  -- Bloquea las cuentas (en orden fijo) antes de leer saldos.
  perform 1 from public.bancas
   where id in (select (e->>'bancaId')::uuid from jsonb_array_elements(v_pagos) e) order by id for update;

  for v_p in select e from jsonb_array_elements(v_pagos) e order by e->>'moneda' loop
    v_moneda := v_p->>'moneda';
    v_banca := (v_p->>'bancaId')::uuid;
    v_lleva := case when jsonb_typeof(v_p->'llevaComision') = 'boolean' then (v_p->>'llevaComision')::boolean end;

    select nombre, moneda, saldo, archivada into v_nom_b, v_mon_b, v_sal_b, v_arch_b from public.bancas where id = v_banca;
    if v_nom_b is null then raise exception 'La cuenta elegida no existe.'; end if;
    if v_arch_b then raise exception 'La cuenta % está archivada.', v_nom_b; end if;
    v_mon_esperada := case v_moneda when 'USD' then 'USD' else 'VES' end;
    if v_mon_b <> v_mon_esperada then
      raise exception 'La cuenta % es en % y este pago es en %.', v_nom_b, v_mon_b, case v_moneda when 'USD' then 'divisas (USD)' else 'bolívares (Bs)' end;
    end if;

    select round(coalesce(sum(case v_moneda when 'USD' then total_usd else total_bs end), 0), 2),
           round(coalesce(sum(total_usd), 0), 2), count(*)
      into v_monto, v_monto_usd, v_cant
      from public.nomina_lineas where nomina_id = v_n.id and moneda_pago = v_moneda;
    v_desc := 'Nómina NOM-' || lpad(v_n.numero::text, 4, '0') || ' · '
      || case v_n.tipo when 'ADMINISTRATIVO' then 'Personal administrativo' else 'Personal operativo' end
      || ' · semana del ' || to_char(v_n.semana_inicio, 'DD/MM/YYYY')
      || ' · ' || case v_moneda when 'USD' then 'divisas' else 'bolívares' end;

    v_comision := null;
    v_com_id := null;
    if v_mon_b = 'VES' and v_lleva is true then
      if to_regprocedure(c_fn_comision) is null then
        raise exception 'La comisión bancaria aún no está habilitada en la base de datos (falta aplicar migration_wallet_comision_bancaria.sql).';
      end if;
      -- Reutiliza la regla vigente de comisión: valida cuenta VES y saldo para monto + comisión.
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
      -- El cargo de comisión bancaria (egreso aparte, comision_de_id) lleva la misma categoría que el egreso principal.
      if v_com_id is not null then
        update public.movimientos set categoria_id = v_cat where id = v_com_id;
      end if;
    end if;

    insert into public.nomina_pagos (nomina_id, moneda_pago, banca_id, movimiento_id, monto, monto_usd, cantidad, fecha, referencia, pagado_por)
    values (v_n.id, v_moneda, v_banca, v_mov_id, v_monto, v_monto_usd, v_cant, v_fecha, v_ref, p_usuario);

    v_res := v_res || jsonb_build_array(jsonb_build_object(
      'moneda', v_moneda, 'bancaId', v_banca, 'movimientoId', v_mov_id, 'numeroSistema', v_num, 'monto', v_monto,
      'comision', v_comision, 'comisionId', v_com_id, 'sinComision', (v_mon_b = 'VES' and v_lleva is false)));
  end loop;

  return jsonb_build_object('yaPagada', false, 'pagos', v_res);
end;
$function$;

-- 4. Anular la nómina: también anula sus egresos del Wallet ---------------------------------------
-- Igual que la versión de migration_nomina.sql, más el bloque "Wallet". Cualquier fallo revierte todo.
create or replace function public.nomina_anular(p_nomina_id uuid, p_motivo text, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_n public.nominas%rowtype;
  v_m record;
  v_p record;
  v_motivo_pago text;
begin
  select * into v_n from public.nominas where id = p_nomina_id for update;
  if not found then
    raise exception 'Nómina no encontrada.' using errcode = 'P0002';
  end if;
  if v_n.estado = 'ANULADA' then
    return jsonb_build_object('yaAnulada', true);
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'El motivo de la anulación es obligatorio.';
  end if;

  if v_n.estado = 'CERRADA' then
    perform set_config('nomina.ledger', '1', true);
    for v_m in
      select m.prestamo_id, m.monto_usd from public.nomina_prestamo_movimientos m
       where m.nomina_id = v_n.id and m.tipo = 'CUOTA'
         and not exists (select 1 from public.nomina_prestamo_movimientos r
                          where r.nomina_id = m.nomina_id and r.prestamo_id = m.prestamo_id and r.tipo = 'REVERSA')
       order by m.prestamo_id
    loop
      update public.nomina_prestamos
         set saldo_usd = saldo_usd + v_m.monto_usd,
             estado = case when estado = 'PAGADO' then 'ACTIVO' else estado end,
             updated_at = now()
       where id = v_m.prestamo_id and estado <> 'ANULADO';
      insert into public.nomina_prestamo_movimientos (prestamo_id, nomina_id, tipo, monto_usd)
      values (v_m.prestamo_id, v_n.id, 'REVERSA', v_m.monto_usd);
    end loop;

    -- Wallet: anula los egresos del pago (y el cargo de comisión) para devolver el dinero a las cuentas.
    perform set_config('app.nomina_pago_rpc', 'on', true);
    v_motivo_pago := 'Nómina NOM-' || lpad(v_n.numero::text, 4, '0') || ' anulada: ' || btrim(p_motivo);
    for v_p in
      select p.movimiento_id, m.comision_bancaria
        from public.nomina_pagos p join public.movimientos m on m.id = p.movimiento_id
       where p.nomina_id = v_n.id and not m.anulado
       order by p.moneda_pago
    loop
      if v_p.comision_bancaria is not null then
        perform public.anular_movimiento_con_comision_bancaria(v_p.movimiento_id, v_motivo_pago, p_usuario);
      else
        perform public.anular_movimiento_banca(v_p.movimiento_id, v_motivo_pago, p_usuario);
      end if;
    end loop;
  end if;

  update public.nominas
     set estado = 'ANULADA', anulada_motivo = btrim(p_motivo), anulada_at = now(), anulada_por = p_usuario, updated_at = now()
   where id = v_n.id;
  return jsonb_build_object('yaAnulada', false);
end;
$function$;

revoke execute on function public.nomina_pagos_proteger() from public, anon, authenticated;
revoke execute on function public.movimientos_nomina_proteger() from public, anon, authenticated;
revoke execute on function public.nomina_pagar(uuid, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.nomina_anular(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.nomina_pagar(uuid, jsonb, uuid) to service_role;
grant execute on function public.nomina_anular(uuid, text, uuid) to service_role;

-- 5. RLS: deny-all para anon/authenticated (service_role bypassa RLS) ---------------------------------
alter table public.nomina_pagos enable row level security;
revoke all on public.nomina_pagos from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'nomina_pagos' and policyname = 'nomina_pagos_deny_anon'
  ) then
    create policy nomina_pagos_deny_anon
      on public.nomina_pagos for all to anon, authenticated using (false) with check (false);
  end if;
end $$;

commit;

-- Que PostgREST vea de inmediato la tabla y las funciones nuevas (sin esperar a su recarga automática).
notify pgrst, 'reload schema';

-- Verificación a mano (solo lectura, después de aplicar):
--   -- nóminas pagadas con el egreso vigente de cada moneda (debe haber una fila por moneda pagada):
--   select n.numero, p.moneda_pago, p.monto, m.numero_sistema, m.anulado, m.categoria_id
--     from public.nomina_pagos p join public.nominas n on n.id = p.nomina_id join public.movimientos m on m.id = p.movimiento_id
--    order by p.created_at desc limit 10;
--   -- nóminas anuladas con un egreso de pago todavía vigente (debe dar 0 filas):
--   select n.numero from public.nominas n join public.nomina_pagos p on p.nomina_id = n.id join public.movimientos m on m.id = p.movimiento_id
--    where n.estado = 'ANULADA' and not m.anulado;
