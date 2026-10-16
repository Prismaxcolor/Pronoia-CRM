-- =============================================================================
-- ROLLBACK de docs/migration_nomina_pago_repartido.sql
--
-- Se niega a correr si ya existe un REPARTO (más de una fila de nomina_pagos para la misma moneda de una nómina completa o de
-- un renglón), vigente o ya anulado: el índice único anterior (una cuenta por moneda) no puede restaurarse sin perder esa
-- historia, y nomina_pagos es inmutable. Solo se puede revertir mientras no se haya repartido ningún pago.
--
-- Restaura nomina_pagar (versión de migration_nomina_dos_sueldos_cargo.sql) y nomina_pagar_trabajador (versión de
-- migration_nomina_pago_por_trabajador.sql), los dos índices únicos anteriores y quita las funciones auxiliares del reparto.
-- Idempotente. Si también se va a revertir migration_nomina_pago_por_trabajador.sql, revierte ESTA primero.
-- =============================================================================

begin;

lock table public.nomina_pagos in share row exclusive mode;

do $$
begin
  if exists (select 1 from public.nomina_pagos where linea_id is null group by nomina_id, moneda_pago having count(*) > 1)
     or exists (select 1 from public.nomina_pagos where linea_id is not null group by linea_id, moneda_pago having count(*) > 1) then
    raise exception 'Hay pagos repartidos entre varias cuentas: no se puede revertir sin perder su historia. Anula las nóminas y conserva el respaldo.';
  end if;
end $$;

create unique index if not exists uq_nomina_pagos_nomina_moneda
  on public.nomina_pagos (nomina_id, moneda_pago) where linea_id is null;
create unique index if not exists uq_nomina_pagos_linea_moneda
  on public.nomina_pagos (linea_id, moneda_pago) where linea_id is not null;
drop index if exists public.uq_nomina_pagos_nomina_moneda_banca;
drop index if exists public.uq_nomina_pagos_linea_moneda_banca;

-- nomina_pagar: versión anterior (una cuenta por moneda).
create or replace function public.nomina_pagar(p_nomina_id uuid, p_datos jsonb, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  c_fn_comision constant text := 'public.crear_movimiento_con_comision_bancaria(text, uuid, uuid, numeric, numeric, text, text, date, uuid, uuid, uuid)';
  v_n          public.nominas%rowtype;
  v_fecha      date := nullif(p_datos->>'fecha', '')::date;
  v_ahora      timestamptz := now();
  v_hoy_real   date := (now() at time zone 'America/Caracas')::date;
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
  v_tasa       numeric;
  v_tasa_cap   timestamptz;
  v_eq_bin     numeric;
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
    select 'USD' as m from public.nomina_lineas where nomina_id = v_n.id having coalesce(sum(pagar_usd), 0) > 0
    union all
    select 'BS' from public.nomina_lineas where nomina_id = v_n.id having coalesce(sum(pagar_bs), 0) > 0
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

    -- Un trabajador con las dos partes aporta a las dos monedas. El equivalente en USD de los Bs es la suma de los
    -- equivalentes de cada renglón (total_usd - lo pagado en divisas), a la tasa de la nómina.
    select round(coalesce(sum(case v_moneda when 'USD' then pagar_usd else pagar_bs end), 0), 2),
           round(coalesce(sum(case v_moneda when 'USD' then pagar_usd else total_usd - pagar_usd end), 0), 2),
           count(*) filter (where case v_moneda when 'USD' then pagar_usd else pagar_bs end > 0)
      into v_monto, v_monto_usd, v_cant
      from public.nomina_lineas where nomina_id = v_n.id;
    -- Pago en Bs: se congela el equivalente a la tasa Binance del mediodía (Caracas) del día REAL del registro (hoy), no de
    -- la fecha que eligió quien paga: así no se puede escoger una fecha para fijar una tasa conveniente.
    v_tasa := null; v_tasa_cap := null; v_eq_bin := null;
    if v_moneda = 'BS' then
      if v_monto_usd <= 0 then
        raise exception 'La parte en Bs es demasiado pequeña para pagarla.';
      end if;
      select t.tasa, t.capturada into v_tasa, v_tasa_cap from public.tasa_binance_del_dia(v_hoy_real) t;
      if v_tasa is not null then v_eq_bin := round(v_monto / v_tasa, 2); end if;
    end if;
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

    insert into public.nomina_pagos (nomina_id, moneda_pago, banca_id, movimiento_id, monto, monto_usd, cantidad, fecha, referencia, pagado_por,
                                     tasa_binance, tasa_binance_capturada, equivalente_binance_usd, registrado_en)
    values (v_n.id, v_moneda, v_banca, v_mov_id, v_monto, v_monto_usd, v_cant, v_fecha, v_ref, p_usuario,
            v_tasa, v_tasa_cap, v_eq_bin, v_ahora);

    v_res := v_res || jsonb_build_array(jsonb_build_object(
      'moneda', v_moneda, 'bancaId', v_banca, 'movimientoId', v_mov_id, 'numeroSistema', v_num, 'monto', v_monto,
      'comision', v_comision, 'comisionId', v_com_id, 'tasaBinance', v_tasa, 'equivalenteBinanceUsd', v_eq_bin, 'sinComision', (v_mon_b = 'VES' and v_lleva is false)));
  end loop;

  return jsonb_build_object('yaPagada', false, 'fechaElegida', v_fecha, 'fechaReal', v_hoy_real, 'pagos', v_res);
end;
$function$;

-- nomina_pagar_trabajador: versión anterior (una cuenta por moneda).
create or replace function public.nomina_pagar_trabajador(p_nomina_id uuid, p_trabajador_id uuid, p_datos jsonb, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  c_fn_comision constant text := 'public.crear_movimiento_con_comision_bancaria(text, uuid, uuid, numeric, numeric, text, text, date, uuid, uuid, uuid)';
  v_n          public.nominas%rowtype;
  v_l          public.nomina_lineas%rowtype;
  v_fecha      date := nullif(p_datos->>'fecha', '')::date;
  v_ahora      timestamptz := now();
  v_hoy_real   date := (now() at time zone 'America/Caracas')::date;
  v_ref        text := nullif(btrim(coalesce(p_datos->>'referencia', '')), '');
  v_cat        uuid := nullif(p_datos->>'categoriaId', '')::uuid;
  v_comp       text[] := '{}';
  v_pagos      jsonb := p_datos->'pagos';
  v_p          jsonb;
  v_moneda     text;
  v_banca      uuid;
  v_lleva      boolean;
  v_monto      numeric;
  v_monto_usd  numeric;
  v_tasa       numeric;
  v_tasa_cap   timestamptz;
  v_eq_bin     numeric;
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
  if exists (select 1 from public.nomina_pagos where nomina_id = v_n.id and linea_id is null) then
    raise exception 'Esta nómina ya se pagó completa desde el Wallet: no se puede pagar por trabajador.';
  end if;
  select * into v_l from public.nomina_lineas where nomina_id = v_n.id and trabajador_id = p_trabajador_id;
  if not found then raise exception 'El trabajador no está en esta nómina.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.nomina_pagos where linea_id = v_l.id) then
    return jsonb_build_object('yaPagada', true);
  end if;

  if v_fecha is null then raise exception 'La fecha del pago es obligatoria.'; end if;
  if v_fecha > v_hoy_real + 1 then raise exception 'La fecha del pago no puede ser posterior a mañana.'; end if;
  if v_fecha < v_n.semana_inicio then raise exception 'La fecha del pago no puede ser anterior a la semana de la nómina.'; end if;
  if jsonb_typeof(v_pagos) is distinct from 'array' or jsonb_array_length(v_pagos) = 0 then
    raise exception 'Elige la cuenta desde la que se paga.';
  end if;
  if jsonb_typeof(p_datos->'comprobantes') = 'array' then
    select coalesce(array_agg(e), '{}') into v_comp from jsonb_array_elements_text(p_datos->'comprobantes') e;
    if cardinality(v_comp) > 10 then raise exception 'Máximo 10 comprobantes.'; end if;
  end if;

  -- Partes del renglón con algo que pagar (la BD es la autoridad: se calcula del renglón, no de lo que mande el navegador).
  select coalesce(array_agg(m order by m), '{}') into v_requeridas from (
    select 'USD' as m where v_l.pagar_usd > 0
    union all
    select 'BS' where v_l.pagar_bs > 0
  ) x;
  if coalesce(array_length(v_requeridas, 1), 0) = 0 then raise exception 'Este trabajador no tiene montos por pagar.'; end if;
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

    -- Monto del renglón en la moneda del pago y su equivalente en USD (el de los Bs: total_usd - lo pagado en divisas).
    v_monto := round(case v_moneda when 'USD' then v_l.pagar_usd else v_l.pagar_bs end, 2);
    v_monto_usd := round(case v_moneda when 'USD' then v_l.pagar_usd else v_l.total_usd - v_l.pagar_usd end, 2);
    -- Pago en Bs: se congela el equivalente a la tasa Binance del mediodía (Caracas) del día REAL del registro (hoy), no de
    -- la fecha que eligió quien paga (misma regla que nomina_pagar).
    v_tasa := null; v_tasa_cap := null; v_eq_bin := null;
    if v_moneda = 'BS' then
      if v_monto_usd <= 0 then
        raise exception 'La parte en Bs es demasiado pequeña para pagarla.';
      end if;
      select t.tasa, t.capturada into v_tasa, v_tasa_cap from public.tasa_binance_del_dia(v_hoy_real) t;
      if v_tasa is not null then v_eq_bin := round(v_monto / v_tasa, 2); end if;
    end if;
    v_desc := 'Nómina NOM-' || lpad(v_n.numero::text, 4, '0') || ' · '
      || case v_n.tipo when 'ADMINISTRATIVO' then 'Personal administrativo' else 'Personal operativo' end
      || ' · semana del ' || to_char(v_n.semana_inicio, 'DD/MM/YYYY')
      || ' · ' || case v_moneda when 'USD' then 'divisas' else 'bolívares' end || ' · pago individual';

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
    -- Comprobante opcional: va en el egreso principal (no en el cargo de comisión).
    if cardinality(v_comp) > 0 then
      update public.movimientos set comprobantes = to_jsonb(v_comp) where id = v_mov_id;
    end if;

    insert into public.nomina_pagos (nomina_id, linea_id, moneda_pago, banca_id, movimiento_id, monto, monto_usd, cantidad, fecha, referencia,
                                     pagado_por, tasa_binance, tasa_binance_capturada, equivalente_binance_usd, registrado_en)
    values (v_n.id, v_l.id, v_moneda, v_banca, v_mov_id, v_monto, v_monto_usd, 1, v_fecha, v_ref,
            p_usuario, v_tasa, v_tasa_cap, v_eq_bin, v_ahora);

    v_res := v_res || jsonb_build_array(jsonb_build_object(
      'moneda', v_moneda, 'bancaId', v_banca, 'movimientoId', v_mov_id, 'numeroSistema', v_num, 'monto', v_monto,
      'comision', v_comision, 'comisionId', v_com_id, 'tasaBinance', v_tasa, 'equivalenteBinanceUsd', v_eq_bin,
      'sinComision', (v_mon_b = 'VES' and v_lleva is false)));
  end loop;

  return jsonb_build_object('yaPagada', false, 'fechaElegida', v_fecha, 'fechaReal', v_hoy_real, 'pagos', v_res);
end;
$function$;

drop function if exists public.nomina_reparto_normalizar(jsonb, numeric, numeric);
drop function if exists public.nomina_reparto_equivalente(numeric, numeric, numeric, numeric, boolean);

revoke execute on function public.nomina_pagar(uuid, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.nomina_pagar_trabajador(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.nomina_pagar(uuid, jsonb, uuid) to service_role;
grant execute on function public.nomina_pagar_trabajador(uuid, uuid, jsonb, uuid) to service_role;

commit;

notify pgrst, 'reload schema';
