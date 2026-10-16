-- =============================================================================
-- Nómina: PAGAR CADA TRABAJADOR por separado desde el Wallet (botón «Pagar» por renglón), con comprobante opcional.
-- Diseño: docs/DISENO_nomina.md (sección «Fase 4»).
--
-- Reutiliza el pago de la fase 2/3 en vez de duplicarlo:
--   * public.nomina_pagos ya liga una nómina con el egreso del Wallet que la pagó. Ahora puede ligar además UN renglón:
--       linea_id NULL     = pago de toda la nómina (nomina_pagar, como hasta hoy; una fila por moneda).
--       linea_id NOT NULL = pago de ese trabajador (nomina_pagar_trabajador; una fila por moneda del renglón, cantidad = 1).
--     Las dos formas son EXCLUYENTES en una misma nómina (trigger): o se paga todo junto o trabajador por trabajador.
--     unique (nomina_id, moneda_pago) pasa a ser un índice único parcial (solo pagos de toda la nómina) y se añade
--     unique (linea_id, moneda_pago) para los individuales: un trabajador nunca se paga dos veces la misma moneda.
--   * public.nomina_pagar_trabajador(nomina, trabajador, datos, usuario) : UNA transacción, misma lógica de nomina_pagar
--     (bloqueo de la nómina y de las cuentas, cuenta vigente de la moneda correcta, saldo, comisión bancaria Sí/No en cuentas
--     Bs, categoría del tipo de personal, tasa Binance congelada del día REAL del registro en pagos Bs, idempotente), pero con
--     los montos del renglón: divisas = pagar_usd, bolívares = pagar_bs (equivalente en USD = total_usd - pagar_usd). Un
--     trabajador con las dos partes se paga en una sola llamada, con una cuenta por moneda (como la nómina completa).
--   * COMPROBANTE: se guarda donde ya viven los de todo el Wallet, en movimientos.comprobantes (text[], URLs del bucket
--     «comprobantes» subidas con POST /api/uploads/comprobantes). No hay tabla ni columna nueva para eso: el comprobante se
--     ve también en el detalle del movimiento del Wallet y sigue siendo editable allí. Máximo 10 por pago.
--   * Anular la nómina anula también estos egresos: nomina_anular (migration_nomina_pago_wallet.sql) recorre TODAS las filas de
--     nomina_pagos de la nómina, tengan o no linea_id, así que no se reemplaza. El guardián movimientos_nomina_proteger también
--     cubre estos egresos (busca por movimiento_id en nomina_pagos).
--
-- No cambia nomina_pagar: si la nómina ya tiene pagos individuales responde yaPagada (ya existe algún pago) y el backend avisa
-- que se paga trabajador por trabajador; el trigger de exclusividad es la defensa de fondo.
--
-- Requisitos aplicados: migration_nomina_pago_wallet.sql, migration_nomina_dos_sueldos_cargo.sql.
-- Migración aditiva e idempotente; no se aplica desde el código.
-- ROLLBACK: docs/migration_nomina_pago_por_trabajador_ROLLBACK.sql
-- CÓMO APLICAR: Supabase Studio -> SQL Editor, con backup previo. Orden de despliegue: migración PRIMERO, luego el código.
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
end $$;

-- 1. nomina_pagos puede ligar un renglón -------------------------------------------------------------------
alter table public.nomina_pagos add column if not exists linea_id uuid references public.nomina_lineas(id) on delete restrict;
create index if not exists idx_nomina_pagos_linea on public.nomina_pagos (linea_id) where linea_id is not null;

-- unique (nomina_id, moneda_pago) -> solo para los pagos de toda la nómina. Se busca la restricción por sus columnas
-- (el nombre lo puso Postgres) para no depender de él.
do $$
declare
  v_nombre text;
begin
  for v_nombre in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.nomina_pagos'::regclass and c.contype = 'u'
       and (select array_agg(a.attname::text order by a.attname::text)
              from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k)
           = array['moneda_pago', 'nomina_id']
  loop
    execute format('alter table public.nomina_pagos drop constraint %I', v_nombre);
  end loop;
end $$;

create unique index if not exists uq_nomina_pagos_nomina_moneda
  on public.nomina_pagos (nomina_id, moneda_pago) where linea_id is null;
create unique index if not exists uq_nomina_pagos_linea_moneda
  on public.nomina_pagos (linea_id, moneda_pago) where linea_id is not null;

-- 2. Exclusividad: o toda la nómina junta, o trabajador por trabajador -------------------------------------------
create or replace function public.nomina_pagos_exclusividad()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.linea_id is null then
    if exists (select 1 from public.nomina_pagos p where p.nomina_id = new.nomina_id and p.linea_id is not null) then
      raise exception 'Esta nómina se está pagando trabajador por trabajador: no se puede pagar completa.';
    end if;
  else
    if exists (select 1 from public.nomina_pagos p where p.nomina_id = new.nomina_id and p.linea_id is null) then
      raise exception 'Esta nómina ya se pagó completa desde el Wallet: no se puede pagar por trabajador.';
    end if;
    if not exists (select 1 from public.nomina_lineas l where l.id = new.linea_id and l.nomina_id = new.nomina_id) then
      raise exception 'El renglón del pago no pertenece a esta nómina.';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_nomina_pagos_exclusividad on public.nomina_pagos;
create trigger trg_nomina_pagos_exclusividad
  before insert on public.nomina_pagos
  for each row execute function public.nomina_pagos_exclusividad();

-- 3. Pagar un trabajador --------------------------------------------------------------------------------------
-- p_datos: {"fecha":"AAAA-MM-DD","referencia":"..."|null,"categoriaId":"uuid"|null,"comprobantes":["url",...],
--           "pagos":[{"moneda":"USD"|"BS","bancaId":"uuid","llevaComision":true|false|null}]}
-- Debe haber un pago por cada parte del renglón que tenga monto (divisas y/o Bs), y ninguno más.
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
      update public.movimientos set comprobantes = v_comp where id = v_mov_id;
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

revoke execute on function public.nomina_pagos_exclusividad() from public, anon, authenticated;
revoke execute on function public.nomina_pagar_trabajador(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.nomina_pagar_trabajador(uuid, uuid, jsonb, uuid) to service_role;

commit;

-- Que PostgREST vea de inmediato la columna y la función nuevas (sin esperar a su recarga automática).
notify pgrst, 'reload schema';

-- Verificación a mano (solo lectura, después de aplicar):
--   -- pagos por trabajador de las nóminas recientes, con el movimiento y si lleva comprobante:
--   select n.numero, l.trabajador_nombre, p.moneda_pago, p.monto, m.numero_sistema, m.anulado, cardinality(m.comprobantes) as comprobantes
--     from public.nomina_pagos p join public.nominas n on n.id = p.nomina_id
--     join public.nomina_lineas l on l.id = p.linea_id join public.movimientos m on m.id = p.movimiento_id
--    order by p.created_at desc limit 20;
--   -- nóminas con pagos de las dos formas a la vez (debe dar 0 filas):
--   select nomina_id from public.nomina_pagos group by nomina_id having bool_or(linea_id is null) and bool_or(linea_id is not null);
