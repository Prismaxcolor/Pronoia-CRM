-- =============================================================================
-- Wallet: los pagos a proveedor y cobros a cliente conservan su categoria al editarse.
--
-- editar_pago_cobro_contable revierte el efecto de la operacion, BORRA sus filas de movimientos y las
-- vuelve a insertar con los valores nuevos; sin este cambio la categoria (categorias_wallet) se perderia
-- en cada edicion contable. Ahora lee la categoria de las filas vigentes antes de borrarlas y la
-- reaplica a las filas nuevas (pago/cobro y adelanto/anticipo).
--
--   * Solo se conserva si la categoria (y su padre) siguen activas: el trigger
--     movimientos_validar_categoria rechaza insertar con una archivada y eso bloquearia la edicion.
--     Si fue archivada, las filas quedan sin categoria.
--   * editar_pago_cobro_campos solo hace UPDATE de otros campos: no toca la categoria. anular_pago_cobro
--     marca anulado, tampoco la toca.
--   * Misma firma que la version vigente: CREATE OR REPLACE, sin sobrecargas. Aditiva e idempotente.
--
-- Requiere migration_wallet_categorias.sql (columna movimientos.categoria_id) ya aplicada.
-- No se aplica desde el codigo. ROLLBACK: docs/migration_categoria_pagos_cobros_ROLLBACK.sql
-- =============================================================================

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'movimientos' and column_name = 'categoria_id') then
    raise exception 'Falta aplicar migration_wallet_categorias.sql (columna movimientos.categoria_id).';
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.editar_pago_cobro_contable(p_grupo_id uuid, p_bancas jsonb, p_monto_usd numeric, p_items jsonb, p_descripcion text, p_referencia text, p_fecha date, p_comprobantes jsonb, p_usuario uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_ctx          record;
  v_es           boolean;
  v_ent          uuid;
  v_item         jsonb;
  v_banca        jsonb;
  v_tipo         text;
  v_cargos       numeric := 0;
  v_creditos     numeric := 0;
  v_total_items  numeric;
  v_total_bancas numeric;
  v_adelanto     numeric;
  v_ids_bancas   uuid[];
  v_ini          jsonb;
  v_nombre       text;
  v_archivada    boolean;
  v_mon_banca    text;
  v_num_pago     bigint;
  v_num_adel     bigint;
  v_creado       timestamptz;
  v_reg          uuid;
  v_comp         jsonb;
  v_restante     numeric;
  v_b_id         uuid;
  v_b_monto      numeric;
  v_b_usd        numeric;
  v_b_mon        text;
  v_b_ref        text;
  v_ap_pago      numeric;
  v_ap_adel      numeric;
  v_m_pago       numeric;
  v_m_adel       numeric;
  v_mov_id       uuid;
  v_pp           uuid;
  v_pa           uuid;
  v_ids          uuid[] := '{}';
  v_tipo_mov     text;
  v_sub_pago     text;
  v_sub_adel     text;
  v_categoria    uuid;
begin
  if p_items is null then p_items := '[]'::jsonb; end if;
  if p_bancas is null or jsonb_typeof(p_bancas) <> 'array' or jsonb_array_length(p_bancas) = 0 then
    raise exception 'Debe indicar al menos una banca. Para dejar la operacion sin movimiento de dinero, anulala.';
  end if;
  if p_monto_usd is null or p_monto_usd <= 0.01 then
    raise exception 'El total debe ser mayor a 0. Para dejar la operacion sin movimiento de dinero, anulala.';
  end if;
  if (select count(*) from jsonb_array_elements(p_bancas)) <>
     (select count(distinct (value->>'bancaId')) from jsonb_array_elements(p_bancas)) then
    raise exception 'No se puede repetir la misma banca.';
  end if;

  select * into v_ctx from public._grupo_pago_contexto(p_grupo_id);
  if v_ctx.anulado then
    raise exception 'Esta operacion esta anulada y no se puede editar.';
  end if;
  if not v_ctx.hay_dinero then
    raise exception 'Un cruce sin movimiento de dinero no admite cambios contables: anulalo y registralo de nuevo.';
  end if;
  v_es := v_ctx.es_proveedor;
  v_ent := v_ctx.entidad_id;
  v_tipo_mov := case when v_es then 'egreso' else 'ingreso' end;
  v_sub_pago := case when v_es then 'pago' else 'cobro' end;
  v_sub_adel := case when v_es then 'adelanto' else 'anticipo' end;

  -- Validacion del payload (igual que registrar_*_multi_banca).
  for v_item in select value from jsonb_array_elements(p_items) as elems(value)
  loop
    v_tipo := v_item->>'tipo';
    if (v_item->>'montoUsd')::numeric is null or (v_item->>'montoUsd')::numeric <= 0 then
      raise exception 'El monto de cada item debe ser mayor a 0.';
    end if;
    if v_tipo in ('factura', 'nota_debito') then
      v_cargos := v_cargos + round((v_item->>'montoUsd')::numeric, 2);
    elsif v_tipo in ('nota_credito', 'adelanto') then
      v_creditos := v_creditos + round((v_item->>'montoUsd')::numeric, 2);
    else
      raise exception 'Tipo de item desconocido: %', v_tipo;
    end if;
  end loop;
  if v_creditos > v_cargos + 0.01 then
    raise exception 'Los creditos aplicados (%) superan lo que se esta pagando/cobrando (%).', v_creditos, v_cargos;
  end if;
  v_total_items := round(v_cargos - v_creditos, 2);
  if abs(v_total_items) <= 0.01 then v_total_items := 0; end if;

  select coalesce(sum((value->>'montoUsd')::numeric), 0) into v_total_bancas
    from jsonb_array_elements(p_bancas) as elems(value);
  if abs(v_total_bancas - p_monto_usd) > 0.01 then
    raise exception 'La suma de las bancas (%) no coincide con el total (%).', v_total_bancas, p_monto_usd;
  end if;
  v_adelanto := round(p_monto_usd - v_total_items, 2);
  if v_adelanto < -0.01 then
    raise exception 'El total (%) es menor a la suma de lo seleccionado (%).', p_monto_usd, v_total_items;
  end if;
  if abs(v_adelanto) <= 0.01 then v_adelanto := 0; end if;

  -- Bloqueos: entidad -> bancas (viejas y nuevas, por id) -> movimientos.
  if v_es then
    perform 1 from public.proveedores where id = v_ent for update;
  else
    perform 1 from public.clientes where id = v_ent for update;
  end if;
  select coalesce(array_agg(distinct b), '{}') into v_ids_bancas from (
    select banca_origen_id as b from public.movimientos
     where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado
    union
    select (value->>'bancaId')::uuid from jsonb_array_elements(p_bancas) as elems(value)
  ) t;
  perform 1 from public.bancas where id = any(v_ids_bancas) order by id for update;
  perform 1 from public.movimientos
   where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado for update;

  for v_banca in select value from jsonb_array_elements(p_bancas) as elems(value)
  loop
    select nombre, archivada, moneda into v_nombre, v_archivada, v_mon_banca
      from public.bancas where id = (v_banca->>'bancaId')::uuid;
    if v_nombre is null then
      raise exception 'Banca % no encontrada.', v_banca->>'bancaId';
    end if;
    if v_archivada then
      raise exception 'La banca % esta archivada.', v_nombre;
    end if;
    if v_banca->>'moneda' is distinct from v_mon_banca then
      raise exception 'La moneda indicada (%) no coincide con la de la banca % (%).', v_banca->>'moneda', v_nombre, v_mon_banca;
    end if;
    if (v_banca->>'monto')::numeric is null or (v_banca->>'monto')::numeric <= 0
       or (v_banca->>'montoUsd')::numeric is null or (v_banca->>'montoUsd')::numeric <= 0 then
      raise exception 'Los montos de cada banca deben ser mayores a 0.';
    end if;
  end loop;

  -- El adelanto/anticipo de esta operacion ya se uso en otra: cambiar sus montos
  -- dejaria esas facturas pagadas con algo que cambio.
  if exists (select 1 from public.pago_aplicaciones a
              where a.tipo = 'adelanto' and a.item_id = p_grupo_id and not a.anulada and a.grupo_id <> p_grupo_id) then
    raise exception 'El adelanto/anticipo generado por esta operacion ya fue aplicado a facturas en otra operacion: no se puede cambiar su parte contable. Anula primero esa operacion.';
  end if;
  if exists (select 1 from public.movimientos m
              where (m.grupo_id = p_grupo_id or (m.grupo_id is null and m.id = p_grupo_id))
                and not m.anulado and m.subtipo in ('pago', 'cobro'))
     and not exists (select 1 from public.pago_aplicaciones a where a.grupo_id = p_grupo_id and not a.anulada) then
    raise exception 'Este pago/cobro se registro con el formato antiguo, sin detalle de facturas, y no admite cambios contables. Anulalo y registralo de nuevo.';
  end if;

  -- Lo que se conserva de la operacion original.
  select max(numero) filter (where subtipo = v_sub_pago), max(numero) filter (where subtipo = v_sub_adel),
         min(creado_en), (array_agg(registrado_por order by creado_en, id))[1]
    into v_num_pago, v_num_adel, v_creado, v_reg
    from public.movimientos
   where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado;
  -- Categoria del Wallet de la operacion (todas sus filas de dinero llevan la misma). Se conserva solo si
  -- sigue vigente: el trigger de movimientos rechaza insertar con una categoria archivada, y eso no debe
  -- bloquear la edicion de un pago antiguo.
  select m.categoria_id into v_categoria
    from public.movimientos m
    join public.categorias_wallet c on c.id = m.categoria_id
    left join public.categorias_wallet cp on cp.id = c.padre_id
   where (m.grupo_id = p_grupo_id or (m.grupo_id is null and m.id = p_grupo_id)) and not m.anulado
     and c.activo and (cp.id is null or cp.activo)
   order by m.creado_en, m.id limit 1;
  if p_comprobantes is null then
    select comprobantes into v_comp from public.movimientos
     where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado
       and jsonb_array_length(comprobantes) > 0
     order by creado_en, id limit 1;
  else
    v_comp := p_comprobantes;
  end if;
  v_comp := coalesce(v_comp, '[]'::jsonb);

  v_ini := public._snapshot_saldos(v_ids_bancas);

  -- Revertir todo el efecto anterior...
  perform public._revertir_aplicaciones_grupo(v_es, p_grupo_id);
  perform public._revertir_saldos_grupo(p_grupo_id);
  delete from public.pago_aplicaciones where grupo_id = p_grupo_id and not anulada;
  delete from public.movimientos
   where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado;

  -- ...y reaplicarlo con los valores nuevos (items primero: si uno falla, todo se revierte).
  for v_item in select value from jsonb_array_elements(p_items) as elems(value)
  loop
    perform public.aplicar_item_cruce(v_es, v_ent, p_grupo_id,
      v_item->>'tipo', (v_item->>'id')::uuid, (v_item->>'montoUsd')::numeric, null::uuid);
  end loop;

  if v_total_items > 0 and v_num_pago is null then
    v_num_pago := nextval(case when v_es then 'public.movimientos_pago_numero_seq' else 'public.movimientos_cobro_numero_seq' end);
  end if;
  if v_adelanto > 0 and v_num_adel is null then
    v_num_adel := nextval(case when v_es then 'public.movimientos_adelanto_numero_seq' else 'public.movimientos_anticipo_cliente_numero_seq' end);
  end if;

  v_restante := v_total_items;
  for v_banca in select value from jsonb_array_elements(p_bancas) as elems(value)
  loop
    v_b_id := (v_banca->>'bancaId')::uuid;
    v_b_monto := (v_banca->>'monto')::numeric;
    v_b_usd := (v_banca->>'montoUsd')::numeric;
    v_b_mon := v_banca->>'moneda';
    v_b_ref := coalesce(nullif(v_banca->>'referencia', ''), nullif(p_referencia, ''));

    v_ap_pago := least(v_b_usd, v_restante);
    v_ap_adel := v_b_usd - v_ap_pago;
    v_restante := v_restante - v_ap_pago;
    v_m_pago := 0;

    if v_ap_pago > 0.01 then
      v_m_pago := round(v_b_monto * v_ap_pago / v_b_usd, 2);
      insert into public.movimientos
        (tipo, subtipo, numero, grupo_id, monto, moneda, monto_usd, descripcion,
         banca_origen_id, banca_destino_id, fecha, referencia, registrado_por, proveedor_id, cliente_id, creado_en, categoria_id)
      values
        (v_tipo_mov, v_sub_pago, v_num_pago, p_grupo_id, v_m_pago, v_b_mon, v_ap_pago,
         coalesce(p_descripcion, ''), v_b_id, null, p_fecha, v_b_ref, v_reg,
         case when v_es then v_ent end, case when v_es then null else v_ent end, v_creado, v_categoria)
      returning id into v_mov_id;
      v_ids := v_ids || v_mov_id;
      if v_pp is null then v_pp := v_mov_id; end if;
    end if;

    if v_ap_adel > 0.01 then
      v_m_adel := v_b_monto - v_m_pago;
      insert into public.movimientos
        (tipo, subtipo, numero, grupo_id, monto, moneda, monto_usd, descripcion,
         banca_origen_id, banca_destino_id, fecha, referencia, registrado_por, proveedor_id, cliente_id, creado_en, categoria_id)
      values
        (v_tipo_mov, v_sub_adel, v_num_adel, p_grupo_id, v_m_adel, v_b_mon, v_ap_adel,
         case when v_total_items > 0 then (case when v_es then 'Adelanto' else 'Anticipo' end) else coalesce(p_descripcion, '') end,
         v_b_id, null, p_fecha, v_b_ref, v_reg,
         case when v_es then v_ent end, case when v_es then null else v_ent end, v_creado, v_categoria)
      returning id into v_mov_id;
      v_ids := v_ids || v_mov_id;
      if v_pa is null then v_pa := v_mov_id; end if;
    end if;
  end loop;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Los montos por banca son demasiado pequenos para registrar movimientos.';
  end if;

  -- Enlaza las notas aplicadas al movimiento principal y deja los comprobantes ahi.
  if v_pp is not null then
    if v_es then
      update public.notas_ajuste_proveedor set movimiento_id = v_pp
       where proveedor_id = v_ent and id in (select (value->>'id')::uuid from jsonb_array_elements(p_items) as elems(value)
                                              where value->>'tipo' in ('nota_debito', 'nota_credito'));
    else
      update public.notas_ajuste_cliente set movimiento_id = v_pp
       where cliente_id = v_ent and id in (select (value->>'id')::uuid from jsonb_array_elements(p_items) as elems(value)
                                            where value->>'tipo' in ('nota_debito', 'nota_credito'));
    end if;
  end if;
  update public.movimientos set comprobantes = v_comp where id = coalesce(v_pp, v_pa);

  perform public._verificar_saldos(v_ini);

  return jsonb_build_object(
    'grupoId', p_grupo_id, 'movimientoIds', to_jsonb(v_ids),
    'numeroPago', v_num_pago, 'numeroAdelanto', v_num_adel);
end;
$function$;

commit;

notify pgrst, 'reload schema';
