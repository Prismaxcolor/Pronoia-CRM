-- =====================================================================
-- Comision bancaria AUTOMATICA por cuenta (Citibank) + adelanto/anticipo de movimientos de Wallet con proveedor.
--
-- SUPUESTO DE NEGOCIO (no estaba definido en el codigo ni en los documentos; CONFIRMAR con Julio antes de aplicar):
--   La cuenta Citibank cobra una comision por cada salida de dinero (egreso o transferencia de Wallet, y pago a
--   proveedor desde esa cuenta). Se asume el mismo porcentaje de la comision de las cuentas en Bs (0.3 %) calculado
--   sobre el monto, SIN minimo en cuentas que no son bolivares (el minimo de 14 es en Bs y no se traslada a USD).
--   La comision se carga SOLA, en la moneda de la cuenta, sin preguntar Si/No. Los ingresos/cobros no llevan comision.
--   Si la regla real es otra (otro porcentaje, un monto fijo por transferencia, un minimo), basta con cambiar los dos
--   valores de la cuenta: no hace falta tocar codigo ni volver a desplegar:
--     update public.bancas set comision_auto_tasa = 0, comision_auto_minimo = 25 where nombre ilike '%citibank%';  -- fijo 25
--     update public.bancas set comision_auto_tasa = null, comision_auto_minimo = null where id = '...';             -- sin comision
--
-- Que hace:
--  1. bancas.comision_auto_tasa (fraccion del monto: 0.003 = 0.3 %) y bancas.comision_auto_minimo (en la moneda de la
--     cuenta). Ambas null = la cuenta no tiene comision automatica (comportamiento de siempre). Comision =
--     greatest(round(monto * tasa, 2), minimo, 0.01).
--  2. Siembra la regla en las cuentas cuyo nombre contiene "citibank" (solo si no tienen una ya).
--  3. crear_movimiento_con_comision_bancaria (Wallet): usa la regla de la cuenta (cualquier moneda) o la de siempre
--     (solo Bs). Ademas, un EGRESO con proveedor nace como ADELANTO (subtipo 'adelanto', grupo propio, correlativo AD-):
--     es el adelanto del estado de cuenta del proveedor. El cargo de comision cita AD- en vez de MV-.
--  4. agregar_comision_bancaria_a_pago (pagos a proveedor): usa la regla de la cuenta o la de siempre.
--  Mismas firmas (CREATE OR REPLACE). Aditiva e idempotente. Una transaccion. No cambia datos salvo la siembra de (2).
--
-- Requisitos: migration_wallet_comision_bancaria.sql y migration_pago_comision_bancaria.sql (y, para que el egreso con
-- proveedor numere su AD- tambien en el insert directo, migration_cruce_parcial_notas_adelanto_descripcion.sql).
-- ROLLBACK: docs/migration_comision_automatica_banca_ROLLBACK.sql. Hacer backup antes de aplicar. NO se aplica sola.
-- =====================================================================

begin;

do $$
begin
  if to_regprocedure('public.crear_movimiento_con_comision_bancaria(text, uuid, uuid, numeric, numeric, text, text, date, uuid, uuid, uuid)') is null then
    raise exception 'Falta aplicar docs/migration_wallet_comision_bancaria.sql antes de esta migración.';
  end if;
  if to_regprocedure('public.agregar_comision_bancaria_a_pago(uuid, uuid)') is null then
    raise exception 'Falta aplicar docs/migration_pago_comision_bancaria.sql antes de esta migración.';
  end if;
end $$;

-- 1. Regla de comision automatica por cuenta -----------------------------------------------------------------
alter table public.bancas
  add column if not exists comision_auto_tasa   numeric,
  add column if not exists comision_auto_minimo numeric;

alter table public.bancas drop constraint if exists bancas_comision_auto_check;
alter table public.bancas add constraint bancas_comision_auto_check check (
  (comision_auto_tasa is null and comision_auto_minimo is null)
  or (coalesce(comision_auto_tasa, 0) >= 0 and coalesce(comision_auto_tasa, 0) <= 0.1
      and coalesce(comision_auto_minimo, 0) >= 0
      and (coalesce(comision_auto_tasa, 0) > 0 or coalesce(comision_auto_minimo, 0) > 0))
);

-- 2. Siembra: Citibank (SUPUESTO, ver cabecera). Solo cuentas que aun no tengan regla.
update public.bancas
   set comision_auto_tasa = 0.003,
       comision_auto_minimo = case when moneda = 'VES' then 14 else 0 end
 where nombre ilike '%citibank%'
   and comision_auto_tasa is null and comision_auto_minimo is null;

-- 3. Wallet: movimiento + comision (regla por cuenta) y egreso con proveedor = adelanto ------------------------
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
  v_tasa     numeric;  v_minimo numeric;
  v_subtipo  text;     v_grupo uuid;     v_numdoc bigint;  v_pct text;  v_codigo text;
  v_usd      numeric;  v_tasa_usd numeric;
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
  -- Regla de la cuenta: si tiene comisión automatica (bancas.comision_auto_*), esa y en su moneda; si no, la de
  -- siempre (0.3 %, minimo 14), que solo aplica a cuentas en bolivares.
  select comision_auto_tasa, comision_auto_minimo into v_tasa, v_minimo from public.bancas where id = p_banca_origen_id;
  if v_tasa is null and v_minimo is null then
    if v_mon_o <> 'VES' then
      raise exception 'La comisión bancaria solo aplica cuando la cuenta de origen está en bolívares (Bs).';
    end if;
    v_tasa := c_tasa;
    v_minimo := c_minimo;
  else
    v_tasa := coalesce(v_tasa, 0);
    v_minimo := coalesce(v_minimo, 0);
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

  v_comision := greatest(round(p_monto * v_tasa, 2), v_minimo, 0.01);
  if v_sal_o < p_monto + v_comision then
    raise exception 'Saldo insuficiente en %: disponible %, se necesita % (monto % + comisión bancaria %).',
      v_nom_o, round(v_sal_o, 2), round(p_monto + v_comision, 2), round(p_monto, 2), v_comision;
  end if;

  -- Un egreso que lleva proveedor es un ADELANTO en su estado de cuenta: nace con subtipo y grupo (el trigger le da su
  -- correlativo AD-). Un movimiento manual comun (sin proveedor, o transferencia) sigue igual.
  v_subtipo := case when p_tipo = 'egreso' and p_proveedor_id is not null then 'adelanto' else null end;
  v_grupo := case when v_subtipo is not null then gen_random_uuid() else null end;

  -- El estado de cuenta del proveedor se lleva en USD: un adelanto desde una cuenta en Bs guarda su equivalente
  -- (Bs / ultima tasa USD->VES: Binance y, si no hay, BCV). Sin tasa no se registra. En USD no hace falta.
  if v_subtipo = 'adelanto' and v_mon_o <> 'USD' then
    if v_mon_o <> 'VES' then
      raise exception 'Un adelanto a proveedor solo se puede registrar desde una cuenta en USD o en Bs.';
    end if;
    select tasa into v_tasa_usd from public.tasas_cambio
     where moneda_origen = 'USD' and moneda_destino = 'VES' and fuente = 'Binance' and tasa > 0
     order by fecha desc limit 1;
    if v_tasa_usd is null then
      select tasa into v_tasa_usd from public.tasas_cambio
       where moneda_origen = 'USD' and moneda_destino = 'VES' and fuente = 'BCV' and tasa > 0
       order by fecha desc limit 1;
    end if;
    if v_tasa_usd is null then
      raise exception 'No hay una tasa de cambio disponible para convertir el adelanto a USD. Registra el pago desde el estado de cuenta.';
    end if;
    v_usd := round(p_monto / v_tasa_usd, 2);
  end if;

  insert into public.movimientos
    (tipo, monto, moneda, descripcion, banca_origen_id, banca_destino_id, fecha, referencia, registrado_por,
     proveedor_id, cliente_id, monto_destino, comision_bancaria, subtipo, grupo_id, monto_usd)
  values
    (v_tipo, p_monto, v_mon_o, coalesce(btrim(p_descripcion), ''), p_banca_origen_id, v_dest, p_fecha, v_ref, p_usuario,
     p_proveedor_id, p_cliente_id, v_mdest, v_comision, v_subtipo, v_grupo, v_usd)
  returning id, numero_sistema, numero into v_mov_id, v_num, v_numdoc;

  v_pct := case when v_tasa > 0 then ' ' || (case when position('.' in round(v_tasa * 100, 3)::text) > 0
                                                 then rtrim(rtrim(round(v_tasa * 100, 3)::text, '0'), '.')
                                                 else round(v_tasa * 100, 3)::text end) || '%' else '' end;
  v_codigo := case when v_subtipo = 'adelanto' then 'AD-' || lpad(coalesce(v_numdoc, 0)::text, 4, '0')
                   when v_num is not null then 'MV-' || lpad(v_num::text, 4, '0') end;

  insert into public.movimientos
    (tipo, monto, moneda, descripcion, banca_origen_id, fecha, referencia, registrado_por, comision_de_id)
  values
    ('egreso', v_comision, v_mon_o,
     'Comisión bancaria' || v_pct || coalesce(' – ' || v_codigo, ''),
     p_banca_origen_id, p_fecha, v_ref, p_usuario, v_mov_id)
  returning id into v_com_id;

  return jsonb_build_object(
    'movimientoId', v_mov_id, 'numeroSistema', v_num, 'comisionId', v_com_id,
    'comision', v_comision, 'totalDebitado', round(p_monto + v_comision, 2));
end;
$$;

-- 4. Pagos a proveedor: cargo de comision con la regla de la cuenta ------------------------------------------
create or replace function public.agregar_comision_bancaria_a_pago(p_movimiento_id uuid, p_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_tasa     constant numeric := 0.003;  -- 0.3 %
  c_minimo   constant numeric := 14;     -- Bs
  v_tasa     numeric;
  v_minimo   numeric;
  v_pct      text;
  m          public.movimientos;
  v_base     numeric;
  v_comision numeric;
  v_codigo   text;
  v_com_id   uuid;
begin
  if p_movimiento_id is null then raise exception 'Falta el movimiento al que se carga la comisión.'; end if;
  if p_usuario is null then raise exception 'Falta el usuario que registra la comisión.'; end if;

  select * into m from public.movimientos where id = p_movimiento_id for update;
  if not found then raise exception 'Movimiento no encontrado.'; end if;
  if m.anulado then raise exception 'El pago está anulado: no se le puede cargar comisión.'; end if;
  if m.tipo::text <> 'egreso' or m.subtipo is null or m.subtipo not in ('pago', 'adelanto') or m.proveedor_id is null then
    raise exception 'La comisión bancaria solo se carga a un pago o adelanto a proveedor.';
  end if;
  if m.comision_bancaria is not null then raise exception 'Este pago ya tiene comisión bancaria.'; end if;

  perform 1 from public.bancas where id = m.banca_origen_id for update;

  -- Regla de la cuenta: comision automatica propia (bancas.comision_auto_*, en su moneda) o la de siempre (0.3 %,
  -- minimo 14), que solo aplica a cuentas en bolivares.
  select comision_auto_tasa, comision_auto_minimo into v_tasa, v_minimo from public.bancas where id = m.banca_origen_id;
  if v_tasa is null and v_minimo is null then
    if m.moneda <> 'VES' then
      raise exception 'La comisión bancaria solo aplica cuando la cuenta de origen está en bolívares (Bs).';
    end if;
    v_tasa := c_tasa;
    v_minimo := c_minimo;
  else
    v_tasa := coalesce(v_tasa, 0);
    v_minimo := coalesce(v_minimo, 0);
  end if;

  select coalesce(sum(x.monto), 0) into v_base
    from public.movimientos x
   where not x.anulado
     and x.tipo::text = 'egreso'
     and x.subtipo in ('pago', 'adelanto')
     and x.banca_origen_id = m.banca_origen_id
     and coalesce(x.grupo_id, x.id) = coalesce(m.grupo_id, m.id);

  v_comision := greatest(round(v_base * v_tasa, 2), v_minimo, 0.01);
  v_pct := case when v_tasa > 0 then ' ' || (case when position('.' in round(v_tasa * 100, 3)::text) > 0
                                                 then rtrim(rtrim(round(v_tasa * 100, 3)::text, '0'), '.')
                                                 else round(v_tasa * 100, 3)::text end) || '%' else '' end;
  v_codigo := case when m.subtipo = 'adelanto' then 'AD-' else 'PG-' end || lpad(coalesce(m.numero, 0)::text, 4, '0');

  insert into public.movimientos
    (tipo, monto, moneda, descripcion, banca_origen_id, fecha, referencia, registrado_por, comision_de_id)
  values
    ('egreso', v_comision, m.moneda, 'Comisión bancaria' || v_pct || ' – ' || v_codigo, m.banca_origen_id, m.fecha,
     m.referencia, p_usuario, m.id)
  returning id into v_com_id;

  -- El principal aún no tiene comisión: el guardián (solo vigila los que ya la tienen) no se interpone.
  update public.movimientos set comision_bancaria = v_comision where id = m.id;

  return jsonb_build_object(
    'comisionId', v_com_id, 'comision', v_comision, 'base', round(v_base, 2),
    'totalDebitado', round(v_base + v_comision, 2));
end;
$$;

commit;

-- Recarga el esquema de PostgREST (columnas nuevas visibles para el backend sin reiniciar).
notify pgrst, 'reload schema';

-- Verificacion a mano (solo lectura, despues de aplicar):
--   select nombre, moneda, comision_auto_tasa, comision_auto_minimo from public.bancas where comision_auto_tasa is not null or comision_auto_minimo is not null;
