-- =============================================================================
-- Nómina: DOS SUELDOS por trabajador (divisas y bolívares) + tasa Binance congelada en los pagos en Bs (cargo del trabajador).
-- Diseño: docs/DISENO_nomina.md (secciones «Dos sueldos» y «Cargo del trabajador»).
--
-- DOS SUELDOS
--   * nomina_trabajadores.pago_diario_bs : sueldo diario en BOLÍVARES (se guarda en Bs). pago_diario_usd pasa a ser el sueldo
--     diario en DIVISAS (la columna no se renombra). Datos existentes: pago_diario_usd queda como sueldo en divisas, salvo un
--     trabajador cuyo ÚLTIMO renglón en una nómina CERRADA (la más reciente) se pagó en Bs con tasa: su sueldo pasa a Bs
--     (pago_diario_usd x tasa de esa nómina) y el de divisas queda en 0. Los borradores no cuentan (aún no son definitivos).
--     Solo corre al crear la columna (idempotente). Antes de convertir se guardan los valores originales en
--     nomina_trabajadores_bak_dos_sueldos (RLS deny-all), y el ROLLBACK los restaura exactos.
--   * nomina_lineas : monto_base_bs, bruto_bs y las dos partes a pagar (pagar_usd, pagar_bs). moneda_pago admite 'MIXTO'
--     (las dos partes); se deduce de los montos. Renglones anteriores: pagar_usd = total_usd si se pagaban en USD, pagar_bs =
--     total_bs si en BS (el dinero y la historia no cambian; se desactiva un momento el trigger que protege renglones
--     cerrados solo para rellenar las columnas nuevas). Renglones en Bs de una nómina en BORRADOR (con tasa): además su
--     sueldo pasa a la parte en Bs (monto_base_bs = sueldo USD x tasa de la nómina, monto_base_usd = 0, bruto_bs) para que al
--     reabrirlos y guardarlos sigan pagándose en bolívares y no pasen en silencio a divisas. Los totales de la nómina no
--     cambian; el original queda en nomina_lineas_bak_dos_sueldos para el ROLLBACK.
--   * nominas.cantidad_trabajadores : personas de la nómina (un trabajador con las dos partes cuenta una vez). Nulo en las
--     anteriores (allí cantidad_divisas + cantidad_bs es exacto).
--   * nomina_guardar / nomina_cerrar / nomina_pagar se reemplazan (misma firma). nomina_guardar sigue aceptando el cuerpo del
--     backend anterior (una moneda de pago por renglón), así el despliegue no se rompe a medias. nomina_pagar toma lo que se
--     paga en cada moneda de pagar_usd / pagar_bs: un renglón con las dos partes alimenta el egreso en USD y el egreso en Bs.
--
-- CARGO DEL TRABAJADOR (tasa Binance al pagar)
--   * nomina_pagos : tasa_binance, tasa_binance_capturada y equivalente_binance_usd. Solo pagos en Bs. Se llenan DENTRO de
--     nomina_pagar y la tabla es inmutable (trigger existente): el equivalente queda congelado. La tasa sale del día REAL del
--     registro del pago (hoy en Caracas), NO de la fecha que elige quien paga (esa solo fecha el egreso, columna fecha);
--     registrado_en guarda el instante real del registro.
--   * tasa_binance_del_dia(fecha) : la tasa Binance (tasas_cambio, fuente 'Binance', USD->VES) capturada más reciente que no
--     pase del MEDIODÍA (12:00) de Caracas de esa fecha, con un máximo de 3 días de antigüedad. Si ese día hubo captura antes
--     de las 12:00 es la del día; si no, la anterior más cercana, y la hora de captura guardada dice cuál se usó. Sin
--     captura dentro de esa ventana devuelve cero filas y el pago se registra sin equivalente (no se inventa).
--   No se toca el mecanismo que llena tasas_cambio.
--
-- Requisitos aplicados: migration_nomina.sql, migration_nomina_pago_wallet.sql (y la tabla tasas_cambio de supabase-schema.sql).
-- Migración aditiva e idempotente; no se aplica desde el código.
-- ROLLBACK: docs/migration_nomina_dos_sueldos_cargo_ROLLBACK.sql
-- CÓMO APLICAR: Supabase Studio -> SQL Editor, con backup previo.
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.nomina_pagos') is null then
    raise exception 'Falta aplicar migration_nomina_pago_wallet.sql.';
  end if;
  if to_regclass('public.tasas_cambio') is null then
    raise exception 'Falta la tabla tasas_cambio (docs/supabase-schema.sql).';
  end if;
end $$;

-- 0. Tablas de respaldo (solo las lee el ROLLBACK; RLS deny-all y sin acceso para anon/authenticated) --------------
create table if not exists public.nomina_trabajadores_bak_dos_sueldos (
  trabajador_id             uuid          primary key,
  pago_diario_usd           numeric(14,2) not null,
  updated_at                timestamptz   not null,
  pago_diario_bs_convertido numeric(18,2) not null,
  respaldado_en             timestamptz   not null default now()
);
create table if not exists public.nomina_lineas_bak_dos_sueldos (
  linea_id                  uuid          primary key,
  monto_base_usd            numeric(14,2) not null,
  monto_base_bs_convertido  numeric(18,2) not null,
  respaldado_en             timestamptz   not null default now()
);
alter table public.nomina_trabajadores_bak_dos_sueldos enable row level security;
alter table public.nomina_lineas_bak_dos_sueldos enable row level security;
revoke all on public.nomina_trabajadores_bak_dos_sueldos from public, anon, authenticated;
revoke all on public.nomina_lineas_bak_dos_sueldos from public, anon, authenticated;

-- 1. Sueldo en bolívares del trabajador ---------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'nomina_trabajadores' and column_name = 'pago_diario_bs') then
    alter table public.nomina_trabajadores
      add column pago_diario_bs numeric(18,2) not null default 0 check (pago_diario_bs >= 0);

    -- Quien cobró en Bs en su último renglón de una nómina CERRADA: su sueldo diario pasa a bolívares (a la tasa de esa nómina).
    -- Primero el respaldo de los valores originales (lo usa el ROLLBACK); luego la conversión desde ese mismo respaldo.
    insert into public.nomina_trabajadores_bak_dos_sueldos (trabajador_id, pago_diario_usd, updated_at, pago_diario_bs_convertido)
    with ultima as (
      select distinct on (l.trabajador_id) l.trabajador_id, l.moneda_pago, n.tasa_bs
        from public.nomina_lineas l join public.nominas n on n.id = l.nomina_id
       where n.estado = 'CERRADA'
       order by l.trabajador_id, n.semana_inicio desc, n.numero desc
    )
    select t.id, t.pago_diario_usd, t.updated_at, round(t.pago_diario_usd * u.tasa_bs, 2)
      from public.nomina_trabajadores t join ultima u on u.trabajador_id = t.id
     where u.moneda_pago = 'BS' and u.tasa_bs is not null and t.pago_diario_usd > 0
    on conflict (trabajador_id) do nothing;

    update public.nomina_trabajadores t
       set pago_diario_bs = b.pago_diario_bs_convertido, pago_diario_usd = 0, updated_at = now()
      from public.nomina_trabajadores_bak_dos_sueldos b
     where b.trabajador_id = t.id;
  end if;
end $$;

-- 2. Renglones: sueldo en Bs y las dos partes a pagar -----------------------------------------------------
alter table public.nomina_lineas add column if not exists monto_base_bs numeric(18,2) not null default 0 check (monto_base_bs >= 0);
alter table public.nomina_lineas add column if not exists bruto_bs numeric(18,2) not null default 0 check (bruto_bs >= 0);
alter table public.nomina_lineas add column if not exists pagar_usd numeric(14,2);
alter table public.nomina_lineas add column if not exists pagar_bs numeric(18,2);

-- Los renglones cerrados están protegidos: se desactiva el trigger solo para rellenar las columnas nuevas (misma
-- transacción, bajo el bloqueo de la tabla; ningún monto histórico cambia).
alter table public.nomina_lineas disable trigger trg_nomina_lineas_proteger;

-- Renglones en Bs de un BORRADOR con tasa: el sueldo pasa a la parte en Bs (a la tasa de la nómina). Primero el respaldo.
-- Quedan: monto_base_bs = sueldo diario USD x tasa, monto_base_usd = 0, bruto_bs = bruto USD x tasa, pagar_bs = total_bs.
-- Los totales guardados en nominas no cambian; al reabrir y guardar el borrador, el cálculo nuevo sigue pagando en Bs
-- (la bonificación, si hubiera, se paga ahora en divisas, como en todo el módulo).
insert into public.nomina_lineas_bak_dos_sueldos (linea_id, monto_base_usd, monto_base_bs_convertido)
select l.id, l.monto_base_usd, round(l.monto_base_usd * n.tasa_bs, 2)
  from public.nomina_lineas l join public.nominas n on n.id = l.nomina_id
 where l.pagar_usd is null and l.moneda_pago = 'BS' and n.estado = 'BORRADOR' and n.tasa_bs is not null and l.monto_base_usd > 0
on conflict (linea_id) do nothing;

update public.nomina_lineas l
   set monto_base_bs = b.monto_base_bs_convertido,
       bruto_bs = round(l.total_bruto_usd * n.tasa_bs, 2),
       monto_base_usd = 0
  from public.nominas n, public.nomina_lineas_bak_dos_sueldos b
 where n.id = l.nomina_id and b.linea_id = l.id and l.pagar_usd is null;

update public.nomina_lineas
   set pagar_usd = case when moneda_pago = 'USD' then total_usd else 0 end,
       pagar_bs  = case when moneda_pago = 'BS' then total_bs else 0 end
 where pagar_usd is null;
alter table public.nomina_lineas enable trigger trg_nomina_lineas_proteger;
alter table public.nomina_lineas alter column pagar_usd set not null;
alter table public.nomina_lineas alter column pagar_usd set default 0;

alter table public.nomina_lineas drop constraint if exists nomina_lineas_moneda_pago_check;
alter table public.nomina_lineas add constraint nomina_lineas_moneda_pago_check check (moneda_pago in ('USD', 'BS', 'MIXTO'));

-- 3. Nómina: cantidad de personas ---------------------------------------------------------------------
alter table public.nominas add column if not exists cantidad_trabajadores integer;

-- 4. Pagos: equivalente en USD a la tasa Binance, congelado ---------------------------------------------
alter table public.nomina_pagos add column if not exists tasa_binance numeric(20,6) check (tasa_binance is null or tasa_binance > 0);
alter table public.nomina_pagos add column if not exists tasa_binance_capturada timestamptz;
alter table public.nomina_pagos add column if not exists equivalente_binance_usd numeric(16,2);
-- Instante REAL en que se registró el pago (la columna fecha es la que eligió quien paga y fecha el egreso).
alter table public.nomina_pagos add column if not exists registrado_en timestamptz;

alter table public.nomina_pagos drop constraint if exists nomina_pagos_tasa_binance_coherente;
alter table public.nomina_pagos add constraint nomina_pagos_tasa_binance_coherente check (
  (tasa_binance is null and tasa_binance_capturada is null and equivalente_binance_usd is null)
  or (moneda_pago = 'BS' and tasa_binance is not null and tasa_binance_capturada is not null and equivalente_binance_usd is not null)
);

-- 5. Tasa Binance del mediodía de un día --------------------------------------------------------------
create or replace function public.tasa_binance_del_dia(p_fecha date)
returns table (id uuid, tasa numeric, capturada timestamptz)
language sql
stable
set search_path = ''
as $function$
  select t.id, t.tasa, t.fecha
    from public.tasas_cambio t
   where t.fuente = 'Binance' and t.moneda_origen = 'USD' and t.moneda_destino = 'VES'
     -- No pasa del mediodía de Caracas (UTC-4) de ese día...
     and t.fecha <= ((p_fecha + time '12:00') at time zone 'America/Caracas')
     -- ...ni tiene más de 3 días de antigüedad respecto a ese mediodía (cubre un fin de semana sin capturas).
     and t.fecha >= ((p_fecha + time '12:00') at time zone 'America/Caracas') - interval '3 days'
   order by t.fecha desc
   limit 1;
$function$;

revoke execute on function public.tasa_binance_del_dia(date) from public, anon, authenticated;
grant execute on function public.tasa_binance_del_dia(date) to service_role;

-- 6. Guardar el borrador con los dos sueldos ------------------------------------------------
create or replace function public.nomina_guardar(p_datos jsonb, p_usuario uuid)
returns uuid
language plpgsql
set search_path = ''
as $function$
declare
  v_tipo text := p_datos->>'tipo';
  v_semana date := (p_datos->>'semanaInicio')::date;
  v_version integer := nullif(p_datos->>'version', '')::integer;
  v_tasa numeric := nullif(p_datos->>'tasaBs', '')::numeric;
  v_t jsonb := p_datos->'totales';
  v_n public.nominas%rowtype;
  v_l jsonb;
  v_c jsonb;
  v_linea uuid;
  v_base_bs numeric;
  v_pagar_usd numeric;
  v_pagar_bs numeric;
begin
  perform pg_advisory_xact_lock(hashtext('nomina:' || v_tipo || ':' || v_semana::text));
  select * into v_n from public.nominas where tipo = v_tipo and semana_inicio = v_semana and estado <> 'ANULADA' for update;
  if not found then
    if v_version is not null then
      raise exception 'Esa nómina ya no existe: recarga la pantalla.';
    end if;
    insert into public.nominas (tipo, semana_inicio, registrado_por) values (v_tipo, v_semana, p_usuario) returning * into v_n;
  else
    if v_n.estado <> 'BORRADOR' then
      raise exception 'La nómina de esa semana ya está cerrada: no se puede editar.';
    end if;
    if v_version is null then
      raise exception 'Ya existe una nómina para esa semana: recarga la pantalla para editarla.';
    end if;
    if v_version <> v_n.version then
      raise exception 'Otra persona modificó esta nómina mientras la editabas: recarga la pantalla.';
    end if;
  end if;

  delete from public.nomina_lineas where nomina_id = v_n.id;
  for v_l in select * from jsonb_array_elements(p_datos->'lineas') loop
    if not exists (select 1 from public.nomina_trabajadores t where t.id = (v_l->>'trabajadorId')::uuid and t.tipo = v_tipo) then
      raise exception 'Un trabajador no existe o no corresponde a este tipo de personal.';
    end if;
    if not exists (select 1 from public.nomina_trabajadores t where t.id = (v_l->>'trabajadorId')::uuid and t.activo) then
      raise exception 'Un trabajador está inactivo: quítalo de la nómina.';
    end if;
    -- Dos sueldos: lo que se paga en divisas y en Bs. Un cuerpo del backend anterior (sin estos campos) trae UNA moneda de
    -- pago por renglón: se interpreta igual que antes para que el despliegue no se rompa a medias.
    v_base_bs := coalesce(nullif(v_l->>'montoBaseBs', '')::numeric, 0);
    v_pagar_usd := coalesce(nullif(v_l->>'pagarUsd', '')::numeric,
                            case when v_l->>'monedaPago' = 'BS' then 0 else (v_l->>'totalUsd')::numeric end);
    v_pagar_bs := coalesce(nullif(v_l->>'pagarBs', '')::numeric,
                           case when v_l->>'monedaPago' = 'BS' then nullif(v_l->>'totalBs', '')::numeric else 0 end);
    if v_pagar_bs is null or (v_tasa is null and v_base_bs > 0) then
      raise exception 'Indica la tasa de la nómina: hay trabajadores con sueldo en bolívares.';
    end if;
    -- Lo ganado del renglón = bruto (divisas + Bs / tasa) + bonificación; las cuotas de préstamo no pueden pasar de eso.
    if (v_l->>'descuentoPrestamoUsd')::numeric > (v_l->>'totalBrutoUsd')::numeric + (v_l->>'bonificacionUsd')::numeric then
      raise exception 'El descuento de préstamo de un trabajador supera lo que ganó en la semana: baja la cuota.';
    end if;
    insert into public.nomina_lineas (
      nomina_id, trabajador_id, trabajador_nombre, moneda_pago, dias_trabajados, monto_base_usd, monto_base_bs, bruto_bs,
      total_bruto_usd, monto_ref_bs, bonificacion_usd, descuento_trabajo_usd, descuento_prestamo_usd, pagar_usd, pagar_bs,
      total_usd, total_bs, nota)
    values (
      v_n.id, (v_l->>'trabajadorId')::uuid, v_l->>'trabajadorNombre',
      case when v_pagar_bs <> 0 and v_pagar_usd <> 0 then 'MIXTO' when v_pagar_bs <> 0 then 'BS' else 'USD' end,
      (v_l->>'diasTrabajados')::numeric, (v_l->>'montoBaseUsd')::numeric, v_base_bs,
      coalesce(nullif(v_l->>'brutoBs', '')::numeric, 0), (v_l->>'totalBrutoUsd')::numeric,
      (v_l->>'montoRefBs')::numeric, (v_l->>'bonificacionUsd')::numeric, (v_l->>'descuentoTrabajoUsd')::numeric,
      (v_l->>'descuentoPrestamoUsd')::numeric, v_pagar_usd, v_pagar_bs, (v_l->>'totalUsd')::numeric,
      nullif(v_l->>'totalBs', '')::numeric, v_l->>'nota')
    returning id into v_linea;
    for v_c in select * from jsonb_array_elements(v_l->'cuotas') loop
      if not exists (
        select 1 from public.nomina_prestamos p
         where p.id = (v_c->>'prestamoId')::uuid and p.trabajador_id = (v_l->>'trabajadorId')::uuid
           and p.estado = 'ACTIVO' and p.saldo_usd >= (v_c->>'montoUsd')::numeric) then
        raise exception 'Una cuota de préstamo no es válida: el préstamo no está activo, no es del trabajador o supera su saldo.';
      end if;
      insert into public.nomina_linea_cuotas (linea_id, prestamo_id, monto_usd)
      values (v_linea, (v_c->>'prestamoId')::uuid, (v_c->>'montoUsd')::numeric);
    end loop;
  end loop;

  -- Los totales los calcula el backend; aquí solo se comprueba que cuadren con los renglones.
  if abs(coalesce((select sum(pagar_usd) from public.nomina_lineas where nomina_id = v_n.id), 0)
         - (v_t->>'totalDivisasUsd')::numeric) > 0.01
     or abs(coalesce((select sum(total_usd - pagar_usd) from public.nomina_lineas where nomina_id = v_n.id), 0)
         - (v_t->>'equivalenteUsdDeBs')::numeric) > 0.01
     or (nullif(v_t->>'totalBs', '') is not null
         and abs(coalesce((select sum(pagar_bs) from public.nomina_lineas where nomina_id = v_n.id), 0)
         - (v_t->>'totalBs')::numeric) > 0.01) then
    raise exception 'Los totales no cuadran con los renglones: recarga la pantalla e inténtalo de nuevo.';
  end if;

  update public.nominas set
    tasa_bs = v_tasa,
    total_divisas_usd = (v_t->>'totalDivisasUsd')::numeric,
    total_bs = nullif(v_t->>'totalBs', '')::numeric,
    total_equivalente_usd = (v_t->>'equivalenteUsdDeBs')::numeric,
    total_combinado_usd = (v_t->>'totalCombinadoUsd')::numeric,
    total_combinado_bs = nullif(v_t->>'totalCombinadoBs', '')::numeric,
    cantidad_divisas = (v_t->>'cantidadDivisas')::integer,
    cantidad_bs = (v_t->>'cantidadBs')::integer,
    cantidad_trabajadores = (select count(*) from public.nomina_lineas where nomina_id = v_n.id),
    version = v_n.version + 1,
    updated_at = now()
   where id = v_n.id;
  return v_n.id;
end;
$function$;

-- 7. Cerrar: la tasa es obligatoria con sueldo en Bs ------------------------------------------
create or replace function public.nomina_cerrar(p_nomina_id uuid, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_n public.nominas%rowtype;
  v_c record;
begin
  select * into v_n from public.nominas where id = p_nomina_id for update;
  if not found then
    raise exception 'Nómina no encontrada.' using errcode = 'P0002';
  end if;
  if v_n.estado = 'CERRADA' then
    return jsonb_build_object('yaCerrada', true);
  end if;
  if v_n.estado = 'ANULADA' then
    raise exception 'No se puede cerrar una nómina anulada.';
  end if;
  if not exists (select 1 from public.nomina_lineas where nomina_id = v_n.id) then
    raise exception 'La nómina no tiene trabajadores.';
  end if;
  -- Un total negativo solo se tolera en borrador (con aviso); una nómina cerrada no puede pagar montos negativos.
  -- También cada parte por separado: una parte negativa compensada por la otra daría un total >= 0 y un pago imposible.
  if exists (select 1 from public.nomina_lineas where nomina_id = v_n.id and (total_usd < 0 or pagar_usd < 0 or pagar_bs < 0)) then
    raise exception 'No se puede cerrar la nómina: hay trabajadores con un total a pagar negativo. Corrige los descuentos o los montos de esos renglones y guarda de nuevo.';
  end if;
  if v_n.tasa_bs is null and exists (
       select 1 from public.nomina_lineas where nomina_id = v_n.id and (moneda_pago <> 'USD' or monto_base_bs > 0)) then
    raise exception 'Indica la tasa para cerrar: hay trabajadores con sueldo en bolívares.';
  end if;

  perform set_config('nomina.ledger', '1', true);
  for v_c in
    select c.prestamo_id, sum(c.monto_usd) as monto
      from public.nomina_lineas l join public.nomina_linea_cuotas c on c.linea_id = l.id
     where l.nomina_id = v_n.id
     group by c.prestamo_id order by c.prestamo_id
  loop
    update public.nomina_prestamos
       set saldo_usd = saldo_usd - v_c.monto,
           estado = case when saldo_usd - v_c.monto = 0 then 'PAGADO' else estado end,
           updated_at = now()
     where id = v_c.prestamo_id and estado = 'ACTIVO' and saldo_usd >= v_c.monto;
    if not found then
      raise exception 'Un préstamo ya no está activo o su saldo es menor que la cuota: revisa los descuentos de préstamo.';
    end if;
    insert into public.nomina_prestamo_movimientos (prestamo_id, nomina_id, tipo, monto_usd)
    values (v_c.prestamo_id, v_n.id, 'CUOTA', v_c.monto);
  end loop;

  update public.nominas set estado = 'CERRADA', cerrada_at = now(), cerrada_por = p_usuario, updated_at = now()
   where id = v_n.id;
  return jsonb_build_object('yaCerrada', false);
end;
$function$;

-- 8. Pagar desde el Wallet con las dos partes y la tasa Binance congelada ----------------------
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

revoke execute on function public.nomina_guardar(jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.nomina_cerrar(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.nomina_pagar(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.nomina_guardar(jsonb, uuid) to service_role;
grant execute on function public.nomina_cerrar(uuid, uuid) to service_role;
grant execute on function public.nomina_pagar(uuid, jsonb, uuid) to service_role;

commit;

-- Que PostgREST vea de inmediato las columnas y funciones nuevas (sin esperar a su recarga automática).
notify pgrst, 'reload schema';

-- Verificación a mano (solo lectura, después de aplicar):
--   -- cada renglón: lo que se paga en cada moneda y su moneda deducida (MIXTO = las dos partes):
--   select moneda_pago, count(*), sum(pagar_usd) divisas, sum(pagar_bs) bs from public.nomina_lineas group by 1;
--   -- pagos en Bs con su tasa congelada (tasa_binance_capturada dice qué captura se usó):
--   select p.monto, p.tasa_binance, p.tasa_binance_capturada, p.equivalente_binance_usd from public.nomina_pagos p where p.moneda_pago = 'BS';
--   -- la tasa que se usaría para pagar hoy:
--   select * from public.tasa_binance_del_dia((now() at time zone 'America/Caracas')::date);
--   -- pagos con fecha elegida distinta del día real del registro:
--   select nomina_id, fecha, (registrado_en at time zone 'America/Caracas')::date as dia_real from public.nomina_pagos where registrado_en is not null and fecha <> (registrado_en at time zone 'America/Caracas')::date;
