-- =============================================================================
-- Nómina: PAGO REPARTIDO entre varias cuentas de la misma moneda (p. ej. 30 USD = 20 de CAJA BINANCE PS + 10 de CAJA CHICA PS).
-- Diseño: docs/DISENO_nomina.md (sección «Fase 5: pago repartido entre varias cuentas»).
--
-- Hasta ahora: UNA cuenta por moneda (un egreso por moneda). Ahora la parte a pagar de una moneda (divisas o Bs) puede
-- repartirse entre VARIAS cuentas de esa moneda, cada una con su monto. Sirve para el pago por trabajador y para el pago de
-- toda la nómina, en USD y en Bs, con CUALQUIER cuenta vigente de la moneda (cajas, bancos, Binance...: no se filtra por
-- nombre ni por tipo).
--
--   * Contrato (compatible hacia atrás). p_datos->'pagos' = [{"moneda","bancaId","llevaComision", "monto"?}]. Un único elemento
--     por moneda SIN monto = pago completo, como antes. Varios elementos de la misma moneda = reparto: TODOS llevan monto,
--     son cuentas distintas, cada monto > 0 con 2 decimales como máximo, y la suma es EXACTAMENTE la parte a pagar de esa
--     moneda (en centavos enteros). Máximo 5 cuentas por moneda.
--   * public.nomina_reparto_normalizar(pagos, total_usd, total_bs) : valida y normaliza el reparto (devuelve cada cuenta con
--     su monto, su posición y cuántas cuentas hay en su moneda). La usan las dos funciones de pago, así la regla vive en un
--     solo lugar. Mensajes en español, sin datos personales.
--   * public.nomina_reparto_equivalente(...) : equivalente en USD de cada parte en Bs, proporcional al monto; la última parte
--     se queda con el resto, de modo que las partes suman EXACTAMENTE el equivalente del renglón / de la nómina.
--   * public.nomina_pagar (toda la nómina) y public.nomina_pagar_trabajador (un renglón) se reemplazan con la misma firma: un
--     egreso por cuenta (cada uno con SU comisión Bs Sí/No, su saldo comprobado, su categoría y, en el pago individual, los
--     comprobantes), una fila de nomina_pagos por egreso, todo en UNA transacción: si una cuenta no tiene saldo no se mueve
--     nada. Cada fila en Bs congela SU equivalente a la tasa Binance del mediodía (Caracas) del día real del registro.
--     Misma idempotencia (yaPagada), exclusividad (trigger nomina_pagos_exclusividad) y auditoría que antes.
--   * Índices únicos de nomina_pagos: (nomina_id, moneda_pago) donde linea_id is null -> (nomina_id, moneda_pago, banca_id) y
--     (linea_id, moneda_pago) donde linea_id is not null -> (linea_id, moneda_pago, banca_id). Una misma cuenta no se repite
--     en la misma moneda, pero ya puede haber varias cuentas por moneda. unique (movimiento_id) sigue igual.
--   * nomina_anular NO cambia: ya recorría TODAS las filas de nomina_pagos de la nómina (sin suponer una por moneda), así que
--     anular devuelve el dinero de TODOS los egresos del reparto. El guardián movimientos_nomina_proteger busca por
--     movimiento_id y también los cubre.
--
-- Requisitos aplicados: migration_nomina_pago_wallet.sql, migration_nomina_dos_sueldos_cargo.sql, migration_nomina_pago_por_trabajador.sql.
-- Migración aditiva e idempotente; no se aplica desde el código. Orden de despliegue: migración PRIMERO, luego el código
-- (el código viejo sigue funcionando con la migración aplicada: un pago sin monto es un pago completo).
-- ADVERTENCIA: NO vuelvas a ejecutar migration_nomina_pago_por_trabajador.sql después de esta (recrearía los índices únicos antiguos,
-- de una cuenta por moneda, y bloquearía los repartos).
-- ROLLBACK: docs/migration_nomina_pago_repartido_ROLLBACK.sql (se niega si ya hay repartos).
-- CÓMO APLICAR: Supabase Studio -> SQL Editor, con backup previo.
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.nomina_pagos') is null then
    raise exception 'Falta aplicar migration_nomina_pago_wallet.sql.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'nomina_pagos' and column_name = 'tasa_binance') then
    raise exception 'Falta aplicar migration_nomina_dos_sueldos_cargo.sql.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'nomina_pagos' and column_name = 'linea_id') then
    raise exception 'Falta aplicar migration_nomina_pago_por_trabajador.sql.';
  end if;
end $$;

-- 1. Unicidad por (nómina o renglón, moneda, cuenta) -------------------------------------------------------------
create unique index if not exists uq_nomina_pagos_nomina_moneda_banca
  on public.nomina_pagos (nomina_id, moneda_pago, banca_id) where linea_id is null;
create unique index if not exists uq_nomina_pagos_linea_moneda_banca
  on public.nomina_pagos (linea_id, moneda_pago, banca_id) where linea_id is not null;

drop index if exists public.uq_nomina_pagos_nomina_moneda;
drop index if exists public.uq_nomina_pagos_linea_moneda;

-- 2. Validar y normalizar el reparto ---------------------------------------------------------------------------------
-- p_pagos: [{"moneda":"USD"|"BS","bancaId":"uuid","llevaComision":bool|null,"monto":numero|null}]. p_total_*: lo que se debe
-- pagar en cada moneda (lo calcula la BD de los renglones). Devuelve el mismo arreglo ordenado por moneda (BS, USD) y por
-- posición, con "monto" (numeric, 2 decimales), "indice" (1..n dentro de su moneda) y "cuentas" (n).
create or replace function public.nomina_reparto_normalizar(p_pagos jsonb, p_total_usd numeric, p_total_bs numeric)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  c_max constant integer := 5;
  v_req    text[] := '{}';
  v_env    text[];
  v_moneda text;
  v_tot_c  bigint;
  v_n      integer;
  v_i      integer;
  v_suma   bigint;
  v_e      jsonb;
  v_monto  numeric;
  v_c      bigint;
  v_banca  uuid;
  v_vistas uuid[];
  v_out    jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_pagos) is distinct from 'array' or jsonb_array_length(p_pagos) = 0 then
    raise exception 'Elige la cuenta desde la que se paga.';
  end if;
  -- Monedas con algo que pagar, en el mismo orden que usaba el pago de una cuenta por moneda (BS antes que USD).
  if coalesce(p_total_bs, 0) > 0 then v_req := array_append(v_req, 'BS'::text); end if;
  if coalesce(p_total_usd, 0) > 0 then v_req := array_append(v_req, 'USD'::text); end if;
  select coalesce(array_agg(distinct e->>'moneda' order by e->>'moneda'), '{}') into v_env from jsonb_array_elements(p_pagos) e;
  if v_env is distinct from v_req then
    raise exception 'Elige una cuenta para cada moneda a pagar (%).', array_to_string(v_req, ' y ');
  end if;

  foreach v_moneda in array v_req loop
    v_tot_c := round(case v_moneda when 'USD' then p_total_usd else p_total_bs end * 100)::bigint;
    select count(*) into v_n from jsonb_array_elements(p_pagos) e where e->>'moneda' = v_moneda;
    if v_n > c_max then raise exception 'Máximo % cuentas por moneda.', c_max; end if;
    v_suma := 0; v_i := 0; v_vistas := '{}';
    for v_e in select e from jsonb_array_elements(p_pagos) with ordinality t(e, ord) where e->>'moneda' = v_moneda order by ord loop
      v_i := v_i + 1;
      v_banca := (v_e->>'bancaId')::uuid;
      if v_banca is null then raise exception 'Elige la cuenta desde la que se paga.'; end if;
      if v_banca = any(v_vistas) then raise exception 'La misma cuenta no puede repetirse dentro del reparto.'; end if;
      v_vistas := v_vistas || v_banca;
      if coalesce(jsonb_typeof(v_e->'monto'), 'null') <> 'null' then
        if jsonb_typeof(v_e->'monto') <> 'number' then raise exception 'El monto de cada cuenta debe ser un número.'; end if;
        v_monto := (v_e->>'monto')::numeric;
        if v_monto <> round(v_monto, 2) then raise exception 'El monto de cada cuenta debe tener como máximo 2 decimales.'; end if;
        if v_monto <= 0 then raise exception 'Cada cuenta del reparto debe llevar un monto mayor a cero.'; end if;
        v_c := round(v_monto * 100)::bigint;
      elsif v_n = 1 then
        v_c := v_tot_c;
      else
        raise exception 'Indica el monto de cada cuenta del reparto.';
      end if;
      v_suma := v_suma + v_c;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'moneda', v_moneda, 'bancaId', v_banca, 'llevaComision', v_e->'llevaComision',
        'monto', v_c::numeric / 100, 'indice', v_i, 'cuentas', v_n));
    end loop;
    if v_suma <> v_tot_c then
      raise exception 'El reparto en % debe sumar exactamente %: % %.', case v_moneda when 'USD' then 'divisas (USD)' else 'bolívares (Bs)' end,
        to_char(v_tot_c::numeric / 100, 'FM999999999990.00'),
        case when v_suma < v_tot_c then 'faltan' else 'se excede en' end,
        to_char(abs(v_tot_c - v_suma)::numeric / 100, 'FM999999999990.00');
    end if;
  end loop;
  return v_out;
end;
$function$;

-- Equivalente en USD de una parte en Bs: proporcional al monto; la última parte toma el resto para que todas sumen el total.
create or replace function public.nomina_reparto_equivalente(
  p_total_usd numeric, p_monto numeric, p_total numeric, p_asignado_usd numeric, p_es_ultima boolean)
returns numeric
language sql
immutable
set search_path = ''
as $function$
  select case when p_es_ultima then round(p_total_usd - p_asignado_usd, 2)
              else round(p_total_usd * p_monto / nullif(p_total, 0), 2) end;
$function$;

-- 3. Pagar toda la nómina (reparto por moneda) -------------------------------------------------------------------------
-- p_datos: {"fecha":"AAAA-MM-DD","referencia":"..."|null,"categoriaId":"uuid"|null,
--           "pagos":[{"moneda":"USD"|"BS","bancaId":"uuid","llevaComision":true|false|null,"monto":numero|null}]}
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

-- 4. Pagar un trabajador (reparto por moneda) ---------------------------------------------------------------------------
-- p_datos: igual que nomina_pagar, más "comprobantes":["url",...] (van en el egreso de CADA cuenta del reparto).
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

revoke execute on function public.nomina_reparto_normalizar(jsonb, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.nomina_reparto_equivalente(numeric, numeric, numeric, numeric, boolean) from public, anon, authenticated;
revoke execute on function public.nomina_pagar(uuid, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.nomina_pagar_trabajador(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.nomina_reparto_normalizar(jsonb, numeric, numeric) to service_role;
grant execute on function public.nomina_reparto_equivalente(numeric, numeric, numeric, numeric, boolean) to service_role;
grant execute on function public.nomina_pagar(uuid, jsonb, uuid) to service_role;
grant execute on function public.nomina_pagar_trabajador(uuid, uuid, jsonb, uuid) to service_role;

commit;

-- Que PostgREST vea de inmediato las funciones nuevas (sin esperar a su recarga automática).
notify pgrst, 'reload schema';

-- Verificación a mano (solo lectura, después de aplicar):
--   -- pagos repartidos (más de una cuenta en la misma moneda de un renglón o de una nómina):
--   select coalesce(linea_id::text, nomina_id::text) as ambito, moneda_pago, count(*) cuentas, sum(monto) total
--     from public.nomina_pagos group by coalesce(linea_id::text, nomina_id::text), moneda_pago having count(*) > 1;
--   -- el reparto de cada renglón suma lo que se le debía (debe dar 0 filas):
--   select p.linea_id, p.moneda_pago from public.nomina_pagos p join public.nomina_lineas l on l.id = p.linea_id
--    group by p.linea_id, p.moneda_pago, l.pagar_usd, l.pagar_bs
--   having sum(p.monto) <> case p.moneda_pago when 'USD' then l.pagar_usd else l.pagar_bs end;
--   -- nóminas anuladas con un egreso de pago todavía vigente (debe dar 0 filas):
--   select n.numero from public.nominas n join public.nomina_pagos p on p.nomina_id = n.id join public.movimientos m on m.id = p.movimiento_id
--    where n.estado = 'ANULADA' and not m.anulado;
