-- ROLLBACK de docs/migration_cruce_pagos_fixes.sql
-- Restaura las tres funciones a su definicion vigente ANTES de la correccion
-- (copiadas de produccion con pg_get_functiondef). No toca datos.
-- Nota: restaurar reintroduce los huecos de correlativos y la falta de
-- validaciones en el pago simple.
begin;

CREATE OR REPLACE FUNCTION public.registrar_pago_proveedor_multi_banca(p_proveedor_id uuid, p_bancas jsonb, p_monto_usd numeric, p_descripcion text, p_referencia text, p_fecha date, p_registrado_por uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_item               jsonb;
  v_banca              jsonb;
  v_tipo               text;
  v_cargos             numeric := 0;
  v_creditos           numeric := 0;
  v_total_items        numeric;
  v_total_bancas       numeric;
  v_adelanto           numeric;
  v_saldo              numeric;
  v_nombre             text;
  v_archivada          boolean;
  v_num_pago           bigint;
  v_num_adel           bigint;
  v_num_cruce          bigint;
  v_grupo_id           uuid;
  v_restante_pago      numeric;
  v_banca_id           uuid;
  v_banca_monto        numeric;
  v_banca_monto_usd    numeric;
  v_banca_moneda       text;
  v_banca_referencia   text;
  v_ap_pago_usd        numeric;
  v_ap_adel_usd        numeric;
  v_monto_pago         numeric;
  v_monto_adel         numeric;
  v_mov_id             uuid;
  v_mov_pago_principal uuid;
  v_mov_adel_principal uuid;
  v_ids                uuid[] := '{}';
begin
  if p_items is null then p_items := '[]'::jsonb; end if;
  if p_bancas is null or jsonb_typeof(p_bancas) <> 'array' then
    raise exception 'Debe indicar al menos una banca de origen.';
  end if;
  if p_monto_usd is null or p_monto_usd < 0 then
    raise exception 'El total a pagar no puede ser negativo.';
  end if;
  -- Sin bancas solo vale un cruce puro (efectivo = 0) con items.
  if jsonb_array_length(p_bancas) = 0 and (p_monto_usd > 0.01 or jsonb_array_length(p_items) = 0) then
    raise exception 'Debe indicar al menos una banca de origen.';
  end if;

  if (select count(*) from jsonb_array_elements(p_bancas)) <>
     (select count(distinct (value->>'bancaId')) from jsonb_array_elements(p_bancas)) then
    raise exception 'No se puede repetir la misma banca en un pago.';
  end if;

  -- Serializa pagos/cruces del mismo proveedor: evita que dos operaciones
  -- concurrentes consuman el mismo adelanto o la misma factura.
  perform 1 from public.proveedores where id = p_proveedor_id for update;
  if not found then
    raise exception 'Proveedor no encontrado.';
  end if;

  -- Facturas y notas de debito suman; notas de credito y adelantos restan.
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
    raise exception 'Los creditos aplicados (notas de credito + adelantos: %) superan lo que se esta pagando (%).', v_creditos, v_cargos;
  end if;

  v_total_items := round(v_cargos - v_creditos, 2);
  if abs(v_total_items) <= 0.01 then v_total_items := 0; end if;

  select coalesce(sum((value->>'montoUsd')::numeric), 0) into v_total_bancas
    from jsonb_array_elements(p_bancas) as elems(value);

  if abs(v_total_bancas - p_monto_usd) > 0.01 then
    raise exception 'La suma de las bancas (%) no coincide con el total a pagar (%).', v_total_bancas, p_monto_usd;
  end if;

  v_adelanto := round(p_monto_usd - v_total_items, 2);
  if v_adelanto < -0.01 then
    raise exception 'El total a pagar (%) es menor a la suma de lo seleccionado (%).', p_monto_usd, v_total_items;
  end if;
  if abs(v_adelanto) <= 0.01 then v_adelanto := 0; end if;

  -- Bloquea las bancas en orden estable (por id) antes de tocar ninguna.
  for v_banca in
    select value from jsonb_array_elements(p_bancas) as elems(value)
    order by (value->>'bancaId')
  loop
    select saldo, nombre, archivada into v_saldo, v_nombre, v_archivada
      from public.bancas where id = (v_banca->>'bancaId')::uuid
      for update;

    if v_saldo is null then
      raise exception 'Banca % no encontrada.', v_banca->>'bancaId';
    end if;
    if v_archivada then
      raise exception 'La banca % esta archivada.', v_nombre;
    end if;
  end loop;

  v_grupo_id := gen_random_uuid();
  if v_total_items > 0 then
    v_num_pago := nextval('public.movimientos_pago_numero_seq');
  end if;
  if v_adelanto > 0 then
    v_num_adel := nextval('public.movimientos_adelanto_numero_seq');
  end if;

  v_restante_pago := v_total_items;

  for v_banca in select value from jsonb_array_elements(p_bancas) as elems(value)
  loop
    v_banca_id := (v_banca->>'bancaId')::uuid;
    v_banca_monto := (v_banca->>'monto')::numeric;
    v_banca_monto_usd := (v_banca->>'montoUsd')::numeric;
    v_banca_moneda := v_banca->>'moneda';
    v_banca_referencia := coalesce(nullif(v_banca->>'referencia', ''), nullif(p_referencia, ''));

    if v_banca_monto_usd <= 0 then
      continue;
    end if;

    v_ap_pago_usd := least(v_banca_monto_usd, v_restante_pago);
    v_ap_adel_usd := v_banca_monto_usd - v_ap_pago_usd;
    v_restante_pago := v_restante_pago - v_ap_pago_usd;
    v_monto_pago := 0;

    if v_ap_pago_usd > 0.01 then
      v_monto_pago := round(v_banca_monto * v_ap_pago_usd / v_banca_monto_usd, 2);

      insert into public.movimientos
        (tipo, subtipo, numero, grupo_id, monto, moneda, monto_usd, descripcion,
         banca_origen_id, banca_destino_id, fecha, referencia, registrado_por, proveedor_id)
      values
        ('egreso', 'pago', v_num_pago, v_grupo_id, v_monto_pago, v_banca_moneda, v_ap_pago_usd,
         nullif(p_descripcion, ''), v_banca_id, null, p_fecha, v_banca_referencia,
         p_registrado_por, p_proveedor_id)
      returning id into v_mov_id;

      v_ids := v_ids || v_mov_id;
      if v_mov_pago_principal is null then v_mov_pago_principal := v_mov_id; end if;
    end if;

    if v_ap_adel_usd > 0.01 then
      v_monto_adel := v_banca_monto - v_monto_pago;

      insert into public.movimientos
        (tipo, subtipo, numero, grupo_id, monto, moneda, monto_usd, descripcion,
         banca_origen_id, banca_destino_id, fecha, referencia, registrado_por, proveedor_id)
      values
        ('egreso', 'adelanto', v_num_adel, v_grupo_id, v_monto_adel, v_banca_moneda, v_ap_adel_usd,
         nullif(case when v_total_items > 0 then 'Adelanto' else p_descripcion end, ''),
         v_banca_id, null, p_fecha, v_banca_referencia, p_registrado_por, p_proveedor_id)
      returning id into v_mov_id;

      v_ids := v_ids || v_mov_id;
      if v_mov_adel_principal is null then v_mov_adel_principal := v_mov_id; end if;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_items) as elems(value)
  loop
    perform public.aplicar_item_cruce(true, p_proveedor_id, v_grupo_id,
      v_item->>'tipo', (v_item->>'id')::uuid, (v_item->>'montoUsd')::numeric, v_mov_pago_principal);
  end loop;

  -- Sin movimiento de dinero el cruce queda como documento propio. El
  -- correlativo se asigna al final: si algun item falla no queda hueco.
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    if jsonb_array_length(p_items) = 0 then
      raise exception 'No hay nada que registrar: indique items a cruzar o un monto a pagar.';
    end if;
    v_num_cruce := nextval('public.cruces_proveedor_numero_seq');
    insert into public.cruces (grupo_id, proveedor_id, numero, fecha, descripcion, registrado_por)
    values (v_grupo_id, p_proveedor_id, v_num_cruce, p_fecha, nullif(p_descripcion, ''), p_registrado_por);
  end if;

  return jsonb_build_object(
    'movimientoPrincipalId', coalesce(v_mov_pago_principal, v_mov_adel_principal),
    'movimientoIds', to_jsonb(v_ids),
    'grupoId', v_grupo_id,
    'numeroPago', v_num_pago,
    'numeroAdelanto', v_num_adel,
    'numeroCruce', v_num_cruce
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_cobro_cliente_multi_banca(p_cliente_id uuid, p_bancas jsonb, p_monto_usd numeric, p_descripcion text, p_referencia text, p_fecha date, p_registrado_por uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_item                   jsonb;
  v_banca                  jsonb;
  v_tipo                   text;
  v_cargos                 numeric := 0;
  v_creditos               numeric := 0;
  v_total_items            numeric;
  v_total_bancas           numeric;
  v_anticipo               numeric;
  v_nombre                 text;
  v_archivada              boolean;
  v_num_cobro              bigint;
  v_num_anticipo           bigint;
  v_num_cruce              bigint;
  v_grupo_id               uuid;
  v_restante_cobro         numeric;
  v_banca_id               uuid;
  v_banca_monto            numeric;
  v_banca_monto_usd        numeric;
  v_banca_moneda           text;
  v_banca_referencia       text;
  v_ap_cobro_usd           numeric;
  v_ap_anticipo_usd        numeric;
  v_monto_cobro            numeric;
  v_monto_anticipo         numeric;
  v_mov_id                 uuid;
  v_mov_cobro_principal    uuid;
  v_mov_anticipo_principal uuid;
  v_ids                    uuid[] := '{}';
begin
  if p_items is null then p_items := '[]'::jsonb; end if;
  if p_bancas is null or jsonb_typeof(p_bancas) <> 'array' then
    raise exception 'Debe indicar al menos una banca de destino.';
  end if;
  if p_monto_usd is null or p_monto_usd < 0 then
    raise exception 'El total a cobrar no puede ser negativo.';
  end if;
  if jsonb_array_length(p_bancas) = 0 and (p_monto_usd > 0.01 or jsonb_array_length(p_items) = 0) then
    raise exception 'Debe indicar al menos una banca de destino.';
  end if;

  if (select count(*) from jsonb_array_elements(p_bancas)) <>
     (select count(distinct (value->>'bancaId')) from jsonb_array_elements(p_bancas)) then
    raise exception 'No se puede repetir la misma banca en un cobro.';
  end if;

  perform 1 from public.clientes where id = p_cliente_id for update;
  if not found then
    raise exception 'Cliente no encontrado.';
  end if;

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
    raise exception 'Los creditos aplicados (notas de credito + anticipos: %) superan lo que se esta cobrando (%).', v_creditos, v_cargos;
  end if;

  v_total_items := round(v_cargos - v_creditos, 2);
  if abs(v_total_items) <= 0.01 then v_total_items := 0; end if;

  select coalesce(sum((value->>'montoUsd')::numeric), 0) into v_total_bancas
    from jsonb_array_elements(p_bancas) as elems(value);

  if abs(v_total_bancas - p_monto_usd) > 0.01 then
    raise exception 'La suma de las bancas (%) no coincide con el total a cobrar (%).', v_total_bancas, p_monto_usd;
  end if;

  v_anticipo := round(p_monto_usd - v_total_items, 2);
  if v_anticipo < -0.01 then
    raise exception 'El total a cobrar (%) es menor a la suma de lo seleccionado (%).', p_monto_usd, v_total_items;
  end if;
  if abs(v_anticipo) <= 0.01 then v_anticipo := 0; end if;

  for v_banca in
    select value from jsonb_array_elements(p_bancas) as elems(value)
    order by (value->>'bancaId')
  loop
    select nombre, archivada into v_nombre, v_archivada
      from public.bancas where id = (v_banca->>'bancaId')::uuid
      for update;

    if v_nombre is null then
      raise exception 'Banca % no encontrada.', v_banca->>'bancaId';
    end if;
    if v_archivada then
      raise exception 'La banca % esta archivada.', v_nombre;
    end if;
  end loop;

  v_grupo_id := gen_random_uuid();
  if v_total_items > 0 then
    v_num_cobro := nextval('public.movimientos_cobro_numero_seq');
  end if;
  if v_anticipo > 0 then
    v_num_anticipo := nextval('public.movimientos_anticipo_cliente_numero_seq');
  end if;

  v_restante_cobro := v_total_items;

  for v_banca in select value from jsonb_array_elements(p_bancas) as elems(value)
  loop
    v_banca_id := (v_banca->>'bancaId')::uuid;
    v_banca_monto := (v_banca->>'monto')::numeric;
    v_banca_monto_usd := (v_banca->>'montoUsd')::numeric;
    v_banca_moneda := v_banca->>'moneda';
    v_banca_referencia := coalesce(nullif(v_banca->>'referencia', ''), nullif(p_referencia, ''));

    if v_banca_monto_usd <= 0 then
      continue;
    end if;

    v_ap_cobro_usd := least(v_banca_monto_usd, v_restante_cobro);
    v_ap_anticipo_usd := v_banca_monto_usd - v_ap_cobro_usd;
    v_restante_cobro := v_restante_cobro - v_ap_cobro_usd;
    v_monto_cobro := 0;

    if v_ap_cobro_usd > 0.01 then
      v_monto_cobro := round(v_banca_monto * v_ap_cobro_usd / v_banca_monto_usd, 2);

      -- tipo='ingreso': banca_origen_id es la que RECIBE la plata.
      insert into public.movimientos
        (tipo, subtipo, numero, grupo_id, monto, moneda, monto_usd, descripcion,
         banca_origen_id, banca_destino_id, fecha, referencia, registrado_por, cliente_id)
      values
        ('ingreso', 'cobro', v_num_cobro, v_grupo_id, v_monto_cobro, v_banca_moneda, v_ap_cobro_usd,
         nullif(p_descripcion, ''), v_banca_id, null, p_fecha, v_banca_referencia,
         p_registrado_por, p_cliente_id)
      returning id into v_mov_id;

      v_ids := v_ids || v_mov_id;
      if v_mov_cobro_principal is null then v_mov_cobro_principal := v_mov_id; end if;
    end if;

    if v_ap_anticipo_usd > 0.01 then
      v_monto_anticipo := v_banca_monto - v_monto_cobro;

      insert into public.movimientos
        (tipo, subtipo, numero, grupo_id, monto, moneda, monto_usd, descripcion,
         banca_origen_id, banca_destino_id, fecha, referencia, registrado_por, cliente_id)
      values
        ('ingreso', 'anticipo', v_num_anticipo, v_grupo_id, v_monto_anticipo, v_banca_moneda, v_ap_anticipo_usd,
         nullif(case when v_total_items > 0 then 'Anticipo' else p_descripcion end, ''),
         v_banca_id, null, p_fecha, v_banca_referencia, p_registrado_por, p_cliente_id)
      returning id into v_mov_id;

      v_ids := v_ids || v_mov_id;
      if v_mov_anticipo_principal is null then v_mov_anticipo_principal := v_mov_id; end if;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_items) as elems(value)
  loop
    perform public.aplicar_item_cruce(false, p_cliente_id, v_grupo_id,
      v_item->>'tipo', (v_item->>'id')::uuid, (v_item->>'montoUsd')::numeric, v_mov_cobro_principal);
  end loop;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    if jsonb_array_length(p_items) = 0 then
      raise exception 'No hay nada que registrar: indique items a cruzar o un monto a cobrar.';
    end if;
    v_num_cruce := nextval('public.cruces_cliente_numero_seq');
    insert into public.cruces (grupo_id, cliente_id, numero, fecha, descripcion, registrado_por)
    values (v_grupo_id, p_cliente_id, v_num_cruce, p_fecha, nullif(p_descripcion, ''), p_registrado_por);
  end if;

  return jsonb_build_object(
    'movimientoPrincipalId', coalesce(v_mov_cobro_principal, v_mov_anticipo_principal),
    'movimientoIds', to_jsonb(v_ids),
    'grupoId', v_grupo_id,
    'numeroCobro', v_num_cobro,
    'numeroAnticipo', v_num_anticipo,
    'numeroCruce', v_num_cruce
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_pago_proveedor(p_proveedor_id uuid, p_banca_id uuid, p_monto numeric, p_moneda text, p_monto_usd numeric, p_descripcion text, p_referencia text, p_fecha date, p_registrado_por uuid, p_factura_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_mov_id   uuid;
  v_total    numeric;
  v_pagado   numeric;
  v_saldo    numeric;
  v_nombre   text;
  v_archivada boolean;
  v_subtipo  text;
begin
  select saldo, nombre, archivada into v_saldo, v_nombre, v_archivada
    from public.bancas where id = p_banca_id
    for update;

  if v_saldo is null then
    raise exception 'Banca no encontrada.';
  end if;
  if v_archivada then
    raise exception 'La banca % está archivada.', v_nombre;
  end if;
  if p_monto > v_saldo + 0.01 then
    raise exception 'Saldo insuficiente en %: disponible %, requerido %', v_nombre, v_saldo, p_monto;
  end if;

  v_subtipo := case when p_factura_id is null then 'adelanto' else 'pago' end;

  insert into public.movimientos
    (tipo, subtipo, monto, moneda, monto_usd, descripcion, banca_origen_id, banca_destino_id,
     fecha, referencia, registrado_por, proveedor_id)
  values
    ('egreso', v_subtipo, p_monto, p_moneda, p_monto_usd, nullif(p_descripcion, ''), p_banca_id, null,
     p_fecha, nullif(p_referencia, ''), p_registrado_por, p_proveedor_id)
  returning id into v_mov_id;

  if p_factura_id is not null then
    select total, monto_pagado into v_total, v_pagado
      from public.facturas_compra where id = p_factura_id;

    if v_total is null then
      raise exception 'Factura no encontrada.';
    end if;

    v_pagado := coalesce(v_pagado, 0) + p_monto_usd;

    update public.facturas_compra
       set monto_pagado = v_pagado,
           estado = case when v_pagado >= v_total - 0.01 then 'pagada' else estado end
     where id = p_factura_id;
  end if;

  return v_mov_id;
end;
$function$;

revoke execute on function public.registrar_pago_proveedor(uuid, uuid, numeric, text, numeric, text, text, date, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.registrar_pago_proveedor_multi_banca(uuid, jsonb, numeric, text, text, date, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.registrar_cobro_cliente_multi_banca(uuid, jsonb, numeric, text, text, date, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_pago_proveedor(uuid, uuid, numeric, text, numeric, text, text, date, uuid, uuid) to service_role;
grant execute on function public.registrar_pago_proveedor_multi_banca(uuid, jsonb, numeric, text, text, date, uuid, jsonb) to service_role;
grant execute on function public.registrar_cobro_cliente_multi_banca(uuid, jsonb, numeric, text, text, date, uuid, jsonb) to service_role;

commit;
