-- =====================================================================
-- Correcciones al cruce de pagos/cobros (revision de codigo).
--
-- 1. registrar_pago_proveedor_multi_banca y registrar_cobro_cliente_multi_banca:
--    los correlativos PG-/AD- (pago a proveedor) y CB-/AC- (cobro a cliente)
--    se tomaban ANTES de aplicar los items del cruce. Si un item fallaba
--    (factura ya pagada, nota anulada, adelanto sin saldo...) la transaccion
--    se revertia pero las secuencias no, y quedaban huecos en la numeracion.
--    Ahora se aplican primero todos los items y los correlativos se toman
--    despues (mismo patron que CR-/CRV-). Como las notas guardan
--    movimiento_id (FK al movimiento principal) y el movimiento aun no existe
--    al aplicar los items, se aplican con movimiento null y se enlazan al
--    final con un UPDATE. Firmas, resultado y efecto final: identicos.
--    (El comentario de docs/migration_cruce_pagos.sql que decia que todos
--    los correlativos se asignaban al final solo era cierto para CR-/CRV-.)
--
-- 2. registrar_pago_proveedor (pago simple, usado por POST /api/pagos ->
--    registrarPago en pago-service.ts): no bloqueaba al proveedor ni la
--    factura, no comprobaba que la factura fuera del proveedor, ni que no
--    estuviera anulada/borrador, ni que el monto no superara su saldo.
--    DECISION: se endurece la funcion en lugar de redirigir registrarPago a
--    la multi_banca. Motivos: (a) el frontend y la ruta usan este contrato
--    (banca unica, monto + montoUsd) y la multi_banca exige otro payload
--    (bancas[], items[]) y cambia semantica (excedente -> adelanto aparte,
--    cruces), lo que obligaria a tocar backend, schema y frontend; (b) el
--    endurecimiento replica las mismas validaciones de aplicar_item_cruce y
--    el mismo orden de bloqueo (proveedor -> banca -> factura) que la
--    multi_banca, sin riesgo de deadlock entre ambas; (c) cero cambios de
--    firma ni de TypeScript. Tambien rechaza montos <= 0 (el schema Zod ya
--    lo hacia; ahora lo garantiza la BD).
--
-- Idempotente (CREATE OR REPLACE) y en una transaccion. No inserta datos.
-- ROLLBACK: docs/migration_cruce_pagos_fixes_ROLLBACK.sql
-- Hacer backup antes de aplicar. Ensayar en una copia antes de produccion.
--
-- Verificacion sugerida tras aplicar (solo lectura):
--   select proname, prosecdef, proconfig from pg_proc
--    where proname in ('registrar_pago_proveedor','registrar_pago_proveedor_multi_banca','registrar_cobro_cliente_multi_banca');
--   -- proconfig debe incluir search_path=public en las tres.
-- =====================================================================

begin;

-- 1a. Pago a proveedor combinado ----------------------------------------
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

  -- Primero se validan y aplican TODOS los items (si uno falla, la excepcion
  -- revierte la transaccion). Aun no hay movimiento, asi que las notas se
  -- enlazan a el al final (ver mas abajo).
  for v_item in select value from jsonb_array_elements(p_items) as elems(value)
  loop
    perform public.aplicar_item_cruce(true, p_proveedor_id, v_grupo_id,
      v_item->>'tipo', (v_item->>'id')::uuid, (v_item->>'montoUsd')::numeric, null::uuid);
  end loop;

  -- Correlativos DESPUES de aplicar los items (las secuencias no se revierten
  -- con la transaccion: tomarlos antes dejaba huecos cuando un item fallaba).
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

  -- Enlaza las notas aplicadas al movimiento principal (igual que antes, que
  -- se lo pasaba a aplicar_item_cruce; en un cruce puro queda en null).
  if v_mov_pago_principal is not null then
    update public.notas_ajuste_proveedor
       set movimiento_id = v_mov_pago_principal
     where proveedor_id = p_proveedor_id
       and id in (select (value->>'id')::uuid
                    from jsonb_array_elements(p_items) as elems(value)
                   where value->>'tipo' in ('nota_debito', 'nota_credito'));
  end if;

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

-- 1b. Cobro a cliente combinado -----------------------------------------
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

  -- Primero se validan y aplican TODOS los items (si uno falla, la excepcion
  -- revierte la transaccion). Aun no hay movimiento, asi que las notas se
  -- enlazan a el al final (ver mas abajo).
  for v_item in select value from jsonb_array_elements(p_items) as elems(value)
  loop
    perform public.aplicar_item_cruce(false, p_cliente_id, v_grupo_id,
      v_item->>'tipo', (v_item->>'id')::uuid, (v_item->>'montoUsd')::numeric, null::uuid);
  end loop;

  -- Correlativos DESPUES de aplicar los items (las secuencias no se revierten
  -- con la transaccion: tomarlos antes dejaba huecos cuando un item fallaba).
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

  -- Enlaza las notas aplicadas al movimiento principal (igual que antes, que
  -- se lo pasaba a aplicar_item_cruce; en un cruce puro queda en null).
  if v_mov_cobro_principal is not null then
    update public.notas_ajuste_cliente
       set movimiento_id = v_mov_cobro_principal
     where cliente_id = p_cliente_id
       and id in (select (value->>'id')::uuid
                    from jsonb_array_elements(p_items) as elems(value)
                   where value->>'tipo' in ('nota_debito', 'nota_credito'));
  end if;

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

-- 2. Pago simple a proveedor, endurecido --------------------------------
CREATE OR REPLACE FUNCTION public.registrar_pago_proveedor(p_proveedor_id uuid, p_banca_id uuid, p_monto numeric, p_moneda text, p_monto_usd numeric, p_descripcion text, p_referencia text, p_fecha date, p_registrado_por uuid, p_factura_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_mov_id    uuid;
  v_total     numeric;
  v_pagado    numeric;
  v_estado    text;
  v_saldo     numeric;
  v_saldo_fac numeric;
  v_nombre    text;
  v_archivada boolean;
  v_subtipo   text;
begin
  if p_monto is null or p_monto <= 0 or p_monto_usd is null or p_monto_usd <= 0 then
    raise exception 'El monto del pago debe ser mayor a 0.';
  end if;

  -- Mismo orden de bloqueo que registrar_pago_proveedor_multi_banca
  -- (proveedor -> banca -> factura): evita deadlocks entre ambas y serializa
  -- pagos concurrentes del mismo proveedor sobre la misma factura.
  perform 1 from public.proveedores where id = p_proveedor_id for update;
  if not found then
    raise exception 'Proveedor no encontrado.';
  end if;

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

  -- Se valida la factura ANTES de mover dinero: debe ser de este proveedor,
  -- estar vigente y no pagarse por encima de su saldo.
  if p_factura_id is not null then
    select total, monto_pagado, estado into v_total, v_pagado, v_estado
      from public.facturas_compra
     where id = p_factura_id and proveedor_id = p_proveedor_id
       for update;

    if v_total is null then
      raise exception 'Factura no encontrada para este proveedor.';
    end if;
    if v_estado in ('anulada', 'borrador') then
      raise exception 'La factura está % y no se puede pagar.', v_estado;
    end if;

    v_saldo_fac := round(v_total - coalesce(v_pagado, 0), 2);
    if p_monto_usd > v_saldo_fac + 0.01 then
      raise exception 'El pago (%) supera el saldo pendiente de la factura (%).', p_monto_usd, v_saldo_fac;
    end if;
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
    v_pagado := round(coalesce(v_pagado, 0) + p_monto_usd, 2);

    update public.facturas_compra
       set monto_pagado = v_pagado,
           estado = case when v_pagado >= v_total - 0.01 then 'pagada' else estado end
     where id = p_factura_id;
  end if;

  return v_mov_id;
end;
$function$;

-- 3. Permisos: solo el backend (service_role) ejecuta estas funciones ----
revoke execute on function public.registrar_pago_proveedor(uuid, uuid, numeric, text, numeric, text, text, date, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.registrar_pago_proveedor_multi_banca(uuid, jsonb, numeric, text, text, date, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.registrar_cobro_cliente_multi_banca(uuid, jsonb, numeric, text, text, date, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_pago_proveedor(uuid, uuid, numeric, text, numeric, text, text, date, uuid, uuid) to service_role;
grant execute on function public.registrar_pago_proveedor_multi_banca(uuid, jsonb, numeric, text, text, date, uuid, jsonb) to service_role;
grant execute on function public.registrar_cobro_cliente_multi_banca(uuid, jsonb, numeric, text, text, date, uuid, jsonb) to service_role;

commit;
