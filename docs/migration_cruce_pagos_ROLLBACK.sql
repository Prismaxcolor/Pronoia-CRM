-- ROLLBACK de docs/migration_cruce_pagos.sql
-- Restaura las dos RPC a su definicion previa y elimina lo nuevo.
-- ATENCION: si ya se registraron cruces, el rollback pierde esos documentos
-- (tabla cruces) y las aplicaciones de adelanto. Antes de ejecutarlo, revisar:
--   select count(*) from public.cruces;
--   select count(*) from public.pago_aplicaciones where tipo = 'adelanto';
-- Si hay filas, los adelantos volverian a figurar como disponibles pero las
-- facturas ya quedaron con monto_pagado actualizado: restaurar desde backup.
begin;

CREATE OR REPLACE FUNCTION public.registrar_pago_proveedor_multi_banca(p_proveedor_id uuid, p_bancas jsonb, p_monto_usd numeric, p_descripcion text, p_referencia text, p_fecha date, p_registrado_por uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_item              jsonb;
  v_banca             jsonb;
  v_tipo               text;
  v_id                 uuid;
  v_monto              numeric;
  v_total              numeric;
  v_pagado             numeric;
  v_filas              int;
  v_total_cargos        numeric;
  v_total_creditos      numeric;
  v_total_items        numeric;
  v_total_bancas       numeric;
  v_adelanto           numeric;
  v_saldo              numeric;
  v_nombre             text;
  v_archivada          boolean;
  v_num_pago           bigint;
  v_num_adel           bigint;
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
  if p_bancas is null or jsonb_typeof(p_bancas) <> 'array' or jsonb_array_length(p_bancas) = 0 then
    raise exception 'Debe indicar al menos una banca de origen.';
  end if;

  if (select count(*) from jsonb_array_elements(p_bancas)) <>
     (select count(distinct (value->>'bancaId')) from jsonb_array_elements(p_bancas)) then
    raise exception 'No se puede repetir la misma banca en un pago.';
  end if;

  select coalesce(sum(case when value->>'tipo' = 'nota_credito' then 0 else (value->>'montoUsd')::numeric end), 0) into v_total_cargos
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as elems(value);

  select coalesce(sum(case when value->>'tipo' = 'nota_credito' then (value->>'montoUsd')::numeric else 0 end), 0) into v_total_creditos
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as elems(value);

  if v_total_creditos > v_total_cargos + 0.01 then
    raise exception 'Las notas de crédito seleccionadas (%) superan lo que se está pagando (%).', v_total_creditos, v_total_cargos;
  end if;

  v_total_items := v_total_cargos - v_total_creditos;

  select coalesce(sum((value->>'montoUsd')::numeric), 0) into v_total_bancas
    from jsonb_array_elements(p_bancas) as elems(value);

  if abs(v_total_bancas - p_monto_usd) > 0.01 then
    raise exception 'La suma de las bancas (%) no coincide con el total a pagar (%).', v_total_bancas, p_monto_usd;
  end if;

  v_adelanto := round(p_monto_usd - v_total_items, 2);
  if v_adelanto < -0.01 then
    raise exception 'El total a pagar (%) es menor a la suma de lo seleccionado (%).', p_monto_usd, v_total_items;
  end if;
  if abs(v_adelanto) <= 0.01 then
    v_adelanto := 0;
  end if;

  -- Bloquea todas las bancas involucradas en orden estable (por id) antes de
  -- tocar ninguna, para no generar deadlocks con otro pago concurrente que
  -- use el mismo conjunto de bancas en distinto orden. Ya NO valida saldo
  -- suficiente — la cuenta puede quedar en negativo (decisión del negocio).
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
      raise exception 'La banca % está archivada.', v_nombre;
    end if;
  end loop;

  v_grupo_id := gen_random_uuid();
  if v_total_items > 0 then
    v_num_pago := nextval('public.movimientos_pago_numero_seq');
  end if;
  if v_adelanto > 0 then
    v_num_adel := nextval('public.movimientos_adelanto_numero_seq');
  end if;

  -- Reparte cada banca entre pago/adelanto en el orden en que el usuario las
  -- cargó (no el orden de bloqueo de arriba, que es solo para evitar
  -- deadlocks): llena primero el pago hasta agotar v_total_items, el resto
  -- de cada banca es adelanto.
  v_restante_pago := v_total_items;

  for v_banca in select value from jsonb_array_elements(p_bancas) as elems(value)
  loop
    v_banca_id := (v_banca->>'bancaId')::uuid;
    v_banca_monto := (v_banca->>'monto')::numeric;
    v_banca_monto_usd := (v_banca->>'montoUsd')::numeric;
    v_banca_moneda := v_banca->>'moneda';
    -- Referencia propia de esta banca; si viene vacía, cae a la referencia
    -- global del pago (compatibilidad con llamadas que no manden por línea).
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
      -- Residuo exacto del monto en moneda local (no se recalcula por
      -- separado) para que la suma pago+adelanto de esta banca sea
      -- exactamente v_banca_monto, sin drift de centavos.
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

  -- Aplica los ítems: factura acumula monto_pagado, nota_debito se marca
  -- pagada (suma al pago), nota_credito también se marca pagada (resta del
  -- pago, ya se descontó de v_total_items arriba) — ambas ligadas a la fila
  -- principal del pago (no a la del adelanto). Cada ítem también queda
  -- grabado en pago_aplicaciones para el desglose del comprobante.
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as elems(value)
  loop
    v_tipo  := v_item->>'tipo';
    v_id    := (v_item->>'id')::uuid;
    v_monto := (v_item->>'montoUsd')::numeric;

    if v_tipo = 'factura' then
      select total, monto_pagado into v_total, v_pagado
        from public.facturas_compra where id = v_id and proveedor_id = p_proveedor_id;

      if v_total is null then
        raise exception 'Factura % no encontrada para este proveedor.', v_id;
      end if;

      v_pagado := coalesce(v_pagado, 0) + v_monto;

      update public.facturas_compra
         set monto_pagado = v_pagado,
             estado = case when v_pagado >= v_total - 0.01 then 'pagada' else estado end
       where id = v_id;

    elsif v_tipo = 'nota_debito' then
      update public.notas_ajuste_proveedor
         set pagada = true,
             movimiento_id = v_mov_pago_principal
       where id = v_id
         and proveedor_id = p_proveedor_id
         and tipo = 'debito'
         and anulada = false
         and pagada = false;

      get diagnostics v_filas = row_count;
      if v_filas = 0 then
        raise exception 'Nota de débito % no encontrada, ya pagada o anulada.', v_id;
      end if;

    elsif v_tipo = 'nota_credito' then
      update public.notas_ajuste_proveedor
         set pagada = true,
             movimiento_id = v_mov_pago_principal
       where id = v_id
         and proveedor_id = p_proveedor_id
         and tipo = 'credito'
         and anulada = false
         and pagada = false;

      get diagnostics v_filas = row_count;
      if v_filas = 0 then
        raise exception 'Nota de crédito % no encontrada, ya aplicada o anulada.', v_id;
      end if;

    else
      raise exception 'Tipo de ítem desconocido: %', v_tipo;
    end if;

    insert into public.pago_aplicaciones (grupo_id, tipo, item_id, monto_usd)
    values (v_grupo_id, v_tipo, v_id, v_monto);
  end loop;

  return jsonb_build_object(
    'movimientoPrincipalId', coalesce(v_mov_pago_principal, v_mov_adel_principal),
    'movimientoIds', to_jsonb(v_ids),
    'grupoId', v_grupo_id,
    'numeroPago', v_num_pago,
    'numeroAdelanto', v_num_adel
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_cobro_cliente_multi_banca(p_cliente_id uuid, p_bancas jsonb, p_monto_usd numeric, p_descripcion text, p_referencia text, p_fecha date, p_registrado_por uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_item              jsonb;
  v_banca             jsonb;
  v_tipo               text;
  v_id                 uuid;
  v_monto              numeric;
  v_total              numeric;
  v_pagado             numeric;
  v_filas              int;
  v_total_cargos        numeric;
  v_total_creditos      numeric;
  v_total_items        numeric;
  v_total_bancas       numeric;
  v_adelanto           numeric;
  v_nombre             text;
  v_archivada          boolean;
  v_num_cobro          bigint;
  v_num_anticipo       bigint;
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
  v_mov_cobro_principal    uuid;
  v_mov_anticipo_principal uuid;
  v_ids                uuid[] := '{}';
begin
  if p_bancas is null or jsonb_typeof(p_bancas) <> 'array' or jsonb_array_length(p_bancas) = 0 then
    raise exception 'Debe indicar al menos una banca de destino.';
  end if;

  if (select count(*) from jsonb_array_elements(p_bancas)) <>
     (select count(distinct (value->>'bancaId')) from jsonb_array_elements(p_bancas)) then
    raise exception 'No se puede repetir la misma banca en un cobro.';
  end if;

  select coalesce(sum(case when value->>'tipo' = 'nota_credito' then 0 else (value->>'montoUsd')::numeric end), 0) into v_total_cargos
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as elems(value);

  select coalesce(sum(case when value->>'tipo' = 'nota_credito' then (value->>'montoUsd')::numeric else 0 end), 0) into v_total_creditos
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as elems(value);

  if v_total_creditos > v_total_cargos + 0.01 then
    raise exception 'Las notas de crédito seleccionadas (%) superan lo que se está cobrando (%).', v_total_creditos, v_total_cargos;
  end if;

  v_total_items := v_total_cargos - v_total_creditos;

  select coalesce(sum((value->>'montoUsd')::numeric), 0) into v_total_bancas
    from jsonb_array_elements(p_bancas) as elems(value);

  if abs(v_total_bancas - p_monto_usd) > 0.01 then
    raise exception 'La suma de las bancas (%) no coincide con el total a cobrar (%).', v_total_bancas, p_monto_usd;
  end if;

  v_adelanto := round(p_monto_usd - v_total_items, 2);
  if v_adelanto < -0.01 then
    raise exception 'El total a cobrar (%) es menor a la suma de lo seleccionado (%).', p_monto_usd, v_total_items;
  end if;
  if abs(v_adelanto) <= 0.01 then
    v_adelanto := 0;
  end if;

  -- Bloquea todas las bancas involucradas en orden estable (por id) antes de
  -- tocar ninguna, mismo criterio anti-deadlock que el pago a proveedor. No
  -- valida saldo — un ingreso nunca puede dejar una banca en negativo.
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
      raise exception 'La banca % está archivada.', v_nombre;
    end if;
  end loop;

  v_grupo_id := gen_random_uuid();
  if v_total_items > 0 then
    v_num_cobro := nextval('public.movimientos_cobro_numero_seq');
  end if;
  if v_adelanto > 0 then
    v_num_anticipo := nextval('public.movimientos_anticipo_cliente_numero_seq');
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

      -- tipo='ingreso': banca_origen_id es la que RECIBE la plata (ver
      -- aplicar_movimiento_a_saldo, Bloque 2) — no banca_destino_id.
      insert into public.movimientos
        (tipo, subtipo, numero, grupo_id, monto, moneda, monto_usd, descripcion,
         banca_origen_id, banca_destino_id, fecha, referencia, registrado_por, cliente_id)
      values
        ('ingreso', 'cobro', v_num_cobro, v_grupo_id, v_monto_pago, v_banca_moneda, v_ap_pago_usd,
         nullif(p_descripcion, ''), v_banca_id, null, p_fecha, v_banca_referencia,
         p_registrado_por, p_cliente_id)
      returning id into v_mov_id;

      v_ids := v_ids || v_mov_id;
      if v_mov_cobro_principal is null then v_mov_cobro_principal := v_mov_id; end if;
    end if;

    if v_ap_adel_usd > 0.01 then
      v_monto_adel := v_banca_monto - v_monto_pago;

      insert into public.movimientos
        (tipo, subtipo, numero, grupo_id, monto, moneda, monto_usd, descripcion,
         banca_origen_id, banca_destino_id, fecha, referencia, registrado_por, cliente_id)
      values
        ('ingreso', 'anticipo', v_num_anticipo, v_grupo_id, v_monto_adel, v_banca_moneda, v_ap_adel_usd,
         nullif(case when v_total_items > 0 then 'Anticipo' else p_descripcion end, ''),
         v_banca_id, null, p_fecha, v_banca_referencia, p_registrado_por, p_cliente_id)
      returning id into v_mov_id;

      v_ids := v_ids || v_mov_id;
      if v_mov_anticipo_principal is null then v_mov_anticipo_principal := v_mov_id; end if;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as elems(value)
  loop
    v_tipo  := v_item->>'tipo';
    v_id    := (v_item->>'id')::uuid;
    v_monto := (v_item->>'montoUsd')::numeric;

    if v_tipo = 'factura' then
      select total, monto_pagado into v_total, v_pagado
        from public.facturas_venta where id = v_id and cliente_id = p_cliente_id;

      if v_total is null then
        raise exception 'Factura % no encontrada para este cliente.', v_id;
      end if;

      v_pagado := coalesce(v_pagado, 0) + v_monto;

      update public.facturas_venta
         set monto_pagado = v_pagado,
             estado = case when v_pagado >= v_total - 0.01 then 'pagada' else estado end
       where id = v_id;

    elsif v_tipo = 'nota_debito' then
      update public.notas_ajuste_cliente
         set pagada = true,
             movimiento_id = v_mov_cobro_principal
       where id = v_id
         and cliente_id = p_cliente_id
         and tipo = 'debito'
         and anulada = false
         and pagada = false;

      get diagnostics v_filas = row_count;
      if v_filas = 0 then
        raise exception 'Nota de débito % no encontrada, ya aplicada o anulada.', v_id;
      end if;

    elsif v_tipo = 'nota_credito' then
      update public.notas_ajuste_cliente
         set pagada = true,
             movimiento_id = v_mov_cobro_principal
       where id = v_id
         and cliente_id = p_cliente_id
         and tipo = 'credito'
         and anulada = false
         and pagada = false;

      get diagnostics v_filas = row_count;
      if v_filas = 0 then
        raise exception 'Nota de crédito % no encontrada, ya aplicada o anulada.', v_id;
      end if;

    else
      raise exception 'Tipo de ítem desconocido: %', v_tipo;
    end if;

    insert into public.pago_aplicaciones (grupo_id, tipo, item_id, monto_usd)
    values (v_grupo_id, v_tipo, v_id, v_monto);
  end loop;

  return jsonb_build_object(
    'movimientoPrincipalId', coalesce(v_mov_cobro_principal, v_mov_anticipo_principal),
    'movimientoIds', to_jsonb(v_ids),
    'grupoId', v_grupo_id,
    'numeroCobro', v_num_cobro,
    'numeroAnticipo', v_num_anticipo
  );
end;
$function$;

drop function if exists public.aplicar_item_cruce(boolean, uuid, uuid, text, uuid, numeric, uuid);
drop function if exists public.adelantos_disponibles(boolean, uuid);
drop table if exists public.cruces;
drop sequence if exists public.cruces_proveedor_numero_seq;
drop sequence if exists public.cruces_cliente_numero_seq;
drop index if exists public.idx_pago_aplicaciones_tipo_item;
alter table public.pago_aplicaciones drop constraint if exists pago_aplicaciones_tipo_check;
-- Falla si quedan filas con tipo = 'adelanto' (ver aviso arriba).
alter table public.pago_aplicaciones
  add constraint pago_aplicaciones_tipo_check
  check (tipo = any (array['factura'::text, 'nota_debito'::text, 'nota_credito'::text]));

commit;
