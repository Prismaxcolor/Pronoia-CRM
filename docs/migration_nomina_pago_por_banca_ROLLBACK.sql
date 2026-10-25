-- =============================================================================
-- ROLLBACK de docs/migration_nomina_pago_por_banca.sql
--
-- Restaura nomina_pagar y nomina_pagar_trabajador tal como las dejó migration_nomina_pago_repartido.sql (una sola referencia
-- general por pago y, en el pago por trabajador, los mismos comprobantes en todas las cuentas). No toca datos: los pagos ya
-- registrados conservan la referencia y los comprobantes de cada egreso. Idempotente.
-- =============================================================================

begin;

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
  v_norm       jsonb;
  v_p          jsonb;
  v_moneda     text;
  v_banca      uuid;
  v_lleva      boolean;
  v_monto      numeric;
  v_monto_usd  numeric;
  v_cant       integer;
  v_tot_usd    numeric;
  v_tot_bs     numeric;
  v_eq_bs      numeric;
  v_asig_usd   numeric := 0;
  v_cuentas    integer;
  v_indice     integer;
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

  -- Lo que se debe pagar en cada moneda (la BD es la autoridad: se calcula de los renglones, no de lo que mande el navegador).
  -- El equivalente en USD de los Bs es la suma de los equivalentes de cada renglón (total_usd - lo pagado en divisas).
  select round(coalesce(sum(pagar_usd), 0), 2), round(coalesce(sum(pagar_bs), 0), 2), round(coalesce(sum(total_usd - pagar_usd), 0), 2)
    into v_tot_usd, v_tot_bs, v_eq_bs from public.nomina_lineas where nomina_id = v_n.id;
  if v_tot_usd <= 0 and v_tot_bs <= 0 then raise exception 'La nómina no tiene montos por pagar.'; end if;
  v_norm := public.nomina_reparto_normalizar(v_pagos, v_tot_usd, v_tot_bs);

  -- Bloquea las cuentas (en orden fijo) antes de leer saldos.
  perform 1 from public.bancas
   where id in (select (e->>'bancaId')::uuid from jsonb_array_elements(v_norm) e) order by id for update;

  for v_p in select e from jsonb_array_elements(v_norm) e loop
    v_moneda := v_p->>'moneda';
    v_banca := (v_p->>'bancaId')::uuid;
    v_lleva := case when jsonb_typeof(v_p->'llevaComision') = 'boolean' then (v_p->>'llevaComision')::boolean end;
    v_monto := (v_p->>'monto')::numeric;
    v_cuentas := (v_p->>'cuentas')::integer;
    v_indice := (v_p->>'indice')::integer;

    select nombre, moneda, saldo, archivada into v_nom_b, v_mon_b, v_sal_b, v_arch_b from public.bancas where id = v_banca;
    if v_nom_b is null then raise exception 'La cuenta elegida no existe.'; end if;
    if v_arch_b then raise exception 'La cuenta % está archivada.', v_nom_b; end if;
    v_mon_esperada := case v_moneda when 'USD' then 'USD' else 'VES' end;
    if v_mon_b <> v_mon_esperada then
      raise exception 'La cuenta % es en % y este pago es en %.', v_nom_b, v_mon_b, case v_moneda when 'USD' then 'divisas (USD)' else 'bolívares (Bs)' end;
    end if;

    select count(*) filter (where case v_moneda when 'USD' then pagar_usd else pagar_bs end > 0)
      into v_cant from public.nomina_lineas where nomina_id = v_n.id;
    -- Equivalente en USD de ESTA cuenta: lo mismo en divisas; en Bs, su parte proporcional (la última toma el resto).
    v_tasa := null; v_tasa_cap := null; v_eq_bin := null;
    if v_moneda = 'USD' then
      v_monto_usd := v_monto;
    else
      v_monto_usd := public.nomina_reparto_equivalente(v_eq_bs, v_monto, v_tot_bs, v_asig_usd, v_indice = v_cuentas);
      v_asig_usd := v_asig_usd + v_monto_usd;
      if v_monto_usd <= 0 then
        raise exception 'La parte en Bs es demasiado pequeña para pagarla.';
      end if;
      -- Se congela el equivalente a la tasa Binance del mediodía (Caracas) del día REAL del registro (hoy), no de la fecha que
      -- eligió quien paga: así no se puede escoger una fecha para fijar una tasa conveniente.
      select t.tasa, t.capturada into v_tasa, v_tasa_cap from public.tasa_binance_del_dia(v_hoy_real) t;
      if v_tasa is not null then v_eq_bin := round(v_monto / v_tasa, 2); end if;
    end if;
    v_desc := 'Nómina NOM-' || lpad(v_n.numero::text, 4, '0') || ' · '
      || case v_n.tipo when 'ADMINISTRATIVO' then 'Personal administrativo' else 'Personal operativo' end
      || ' · semana del ' || to_char(v_n.semana_inicio, 'DD/MM/YYYY')
      || ' · ' || case v_moneda when 'USD' then 'divisas' else 'bolívares' end
      || case when v_cuentas > 1 then ' · reparto ' || v_indice || '/' || v_cuentas else '' end;

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
  v_norm       jsonb;
  v_p          jsonb;
  v_moneda     text;
  v_banca      uuid;
  v_lleva      boolean;
  v_monto      numeric;
  v_monto_usd  numeric;
  v_tot_usd    numeric;
  v_tot_bs     numeric;
  v_eq_bs      numeric;
  v_asig_usd   numeric := 0;
  v_cuentas    integer;
  v_indice     integer;
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
  -- El equivalente en USD de los Bs es total_usd - lo pagado en divisas.
  v_tot_usd := round(coalesce(v_l.pagar_usd, 0), 2);
  v_tot_bs := round(coalesce(v_l.pagar_bs, 0), 2);
  v_eq_bs := round(coalesce(v_l.total_usd, 0) - coalesce(v_l.pagar_usd, 0), 2);
  if v_tot_usd <= 0 and v_tot_bs <= 0 then raise exception 'Este trabajador no tiene montos por pagar.'; end if;
  v_norm := public.nomina_reparto_normalizar(v_pagos, v_tot_usd, v_tot_bs);

  -- Bloquea las cuentas (en orden fijo) antes de leer saldos.
  perform 1 from public.bancas
   where id in (select (e->>'bancaId')::uuid from jsonb_array_elements(v_norm) e) order by id for update;

  for v_p in select e from jsonb_array_elements(v_norm) e loop
    v_moneda := v_p->>'moneda';
    v_banca := (v_p->>'bancaId')::uuid;
    v_lleva := case when jsonb_typeof(v_p->'llevaComision') = 'boolean' then (v_p->>'llevaComision')::boolean end;
    v_monto := (v_p->>'monto')::numeric;
    v_cuentas := (v_p->>'cuentas')::integer;
    v_indice := (v_p->>'indice')::integer;

    select nombre, moneda, saldo, archivada into v_nom_b, v_mon_b, v_sal_b, v_arch_b from public.bancas where id = v_banca;
    if v_nom_b is null then raise exception 'La cuenta elegida no existe.'; end if;
    if v_arch_b then raise exception 'La cuenta % está archivada.', v_nom_b; end if;
    v_mon_esperada := case v_moneda when 'USD' then 'USD' else 'VES' end;
    if v_mon_b <> v_mon_esperada then
      raise exception 'La cuenta % es en % y este pago es en %.', v_nom_b, v_mon_b, case v_moneda when 'USD' then 'divisas (USD)' else 'bolívares (Bs)' end;
    end if;

    -- Equivalente en USD de ESTA cuenta: lo mismo en divisas; en Bs, su parte proporcional (la última toma el resto).
    v_tasa := null; v_tasa_cap := null; v_eq_bin := null;
    if v_moneda = 'USD' then
      v_monto_usd := v_monto;
    else
      v_monto_usd := public.nomina_reparto_equivalente(v_eq_bs, v_monto, v_tot_bs, v_asig_usd, v_indice = v_cuentas);
      v_asig_usd := v_asig_usd + v_monto_usd;
      if v_monto_usd <= 0 then
        raise exception 'La parte en Bs es demasiado pequeña para pagarla.';
      end if;
      -- Tasa Binance del mediodía (Caracas) del día REAL del registro (hoy), no de la fecha que eligió quien paga.
      select t.tasa, t.capturada into v_tasa, v_tasa_cap from public.tasa_binance_del_dia(v_hoy_real) t;
      if v_tasa is not null then v_eq_bin := round(v_monto / v_tasa, 2); end if;
    end if;
    v_desc := 'Nómina NOM-' || lpad(v_n.numero::text, 4, '0') || ' · '
      || case v_n.tipo when 'ADMINISTRATIVO' then 'Personal administrativo' else 'Personal operativo' end
      || ' · semana del ' || to_char(v_n.semana_inicio, 'DD/MM/YYYY')
      || ' · ' || case v_moneda when 'USD' then 'divisas' else 'bolívares' end || ' · pago individual'
      || case when v_cuentas > 1 then ' · reparto ' || v_indice || '/' || v_cuentas else '' end;

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
    -- Comprobante opcional del pago del trabajador: va en el egreso principal de cada cuenta (no en el cargo de comisión).
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

revoke execute on function public.nomina_pagar(uuid, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.nomina_pagar_trabajador(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.nomina_pagar(uuid, jsonb, uuid) to service_role;
grant execute on function public.nomina_pagar_trabajador(uuid, uuid, jsonb, uuid) to service_role;

commit;

-- Que PostgREST vea de inmediato las funciones nuevas (sin esperar a su recarga automática).
notify pgrst, 'reload schema';
