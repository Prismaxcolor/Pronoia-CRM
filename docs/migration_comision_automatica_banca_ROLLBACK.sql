-- ROLLBACK de docs/migration_comision_automatica_banca.sql: restaura las dos funciones anteriores y quita la regla por cuenta.
-- Los cargos de comision ya creados no se tocan. Un egreso con proveedor registrado por Wallet mientras la migracion
-- estuvo aplicada queda como adelanto (subtipo 'adelanto'): no se revierte.
begin;

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

create or replace function public.agregar_comision_bancaria_a_pago(p_movimiento_id uuid, p_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_tasa     constant numeric := 0.003;  -- 0.3 %
  c_minimo   constant numeric := 14;     -- Bs
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
  if m.moneda <> 'VES' then
    raise exception 'La comisión bancaria solo aplica cuando la cuenta de origen está en bolívares (Bs).';
  end if;
  if m.comision_bancaria is not null then raise exception 'Este pago ya tiene comisión bancaria.'; end if;

  perform 1 from public.bancas where id = m.banca_origen_id for update;

  select coalesce(sum(x.monto), 0) into v_base
    from public.movimientos x
   where not x.anulado
     and x.tipo::text = 'egreso'
     and x.subtipo in ('pago', 'adelanto')
     and x.banca_origen_id = m.banca_origen_id
     and coalesce(x.grupo_id, x.id) = coalesce(m.grupo_id, m.id);

  v_comision := greatest(round(v_base * c_tasa, 2), c_minimo);
  v_codigo := case when m.subtipo = 'adelanto' then 'AD-' else 'PG-' end || lpad(coalesce(m.numero, 0)::text, 4, '0');

  insert into public.movimientos
    (tipo, monto, moneda, descripcion, banca_origen_id, fecha, referencia, registrado_por, comision_de_id)
  values
    ('egreso', v_comision, m.moneda, 'Comisión bancaria 0.3% – ' || v_codigo, m.banca_origen_id, m.fecha,
     m.referencia, p_usuario, m.id)
  returning id into v_com_id;

  -- El principal aún no tiene comisión: el guardián (solo vigila los que ya la tienen) no se interpone.
  update public.movimientos set comision_bancaria = v_comision where id = m.id;

  return jsonb_build_object(
    'comisionId', v_com_id, 'comision', v_comision, 'base', round(v_base, 2),
    'totalDebitado', round(v_base + v_comision, 2));
end;
$$;

alter table public.bancas drop constraint if exists bancas_comision_auto_check;
alter table public.bancas drop column if exists comision_auto_tasa;
alter table public.bancas drop column if exists comision_auto_minimo;

commit;

notify pgrst, 'reload schema';
