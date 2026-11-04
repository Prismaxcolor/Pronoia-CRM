-- ROLLBACK de docs/migration_cruce_parcial_notas_adelanto_descripcion.sql: restaura las versiones anteriores de las
-- funciones (tomadas de las migraciones que las definieron por ultima vez). Si hay notas aplicadas en parte, revisalas
-- antes: la version anterior asume notas aplicadas completas (pagada = true).
begin;

create or replace function public.aplicar_item_cruce(p_es_proveedor boolean, p_entidad_id uuid, p_grupo_id uuid, p_tipo text, p_id uuid, p_monto numeric, p_movimiento_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_total     numeric;
  v_pagado    numeric;
  v_estado    text;
  v_saldo     numeric;
  v_nuevo     numeric;
  v_aplicado  numeric;
  v_nota_tipo text;
  v_nota_mto  numeric;
  v_anulada   boolean;
  v_pagada    boolean;
  v_nota_ok   boolean;
  v_etiqueta  text := case when p_es_proveedor then 'proveedor' else 'cliente' end;
begin
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto de cada item debe ser mayor a 0.';
  end if;

  if p_tipo = 'factura' then
    if p_es_proveedor then
      select total, monto_pagado, estado into v_total, v_pagado, v_estado
        from public.facturas_compra where id = p_id and proveedor_id = p_entidad_id for update;
    else
      select total, monto_pagado, estado into v_total, v_pagado, v_estado
        from public.facturas_venta where id = p_id and cliente_id = p_entidad_id for update;
    end if;

    if v_total is null then
      raise exception 'Factura % no encontrada para este %.', p_id, v_etiqueta;
    end if;
    if v_estado in ('anulada', 'borrador') then
      raise exception 'La factura % esta % y no se puede pagar ni cruzar.', p_id, v_estado;
    end if;

    v_saldo := round(v_total - coalesce(v_pagado, 0), 2);
    if p_monto > v_saldo + 0.01 then
      raise exception 'El monto aplicado a la factura % (%) supera su saldo pendiente (%).', p_id, p_monto, v_saldo;
    end if;

    v_nuevo := round(coalesce(v_pagado, 0) + p_monto, 2);
    if p_es_proveedor then
      update public.facturas_compra
         set monto_pagado = v_nuevo,
             estado = case when v_nuevo >= v_total - 0.01 then 'pagada' else estado end
       where id = p_id;
    else
      update public.facturas_venta
         set monto_pagado = v_nuevo,
             estado = case when v_nuevo >= v_total - 0.01 then 'pagada' else estado end
       where id = p_id;
    end if;

  elsif p_tipo in ('nota_debito', 'nota_credito') then
    -- Las notas se consumen completas (pagada = true), nunca en parte.
    if p_es_proveedor then
      select tipo, monto, anulada, pagada into v_nota_tipo, v_nota_mto, v_anulada, v_pagada
        from public.notas_ajuste_proveedor where id = p_id and proveedor_id = p_entidad_id for update;
    else
      select tipo, monto, anulada, pagada into v_nota_tipo, v_nota_mto, v_anulada, v_pagada
        from public.notas_ajuste_cliente where id = p_id and cliente_id = p_entidad_id for update;
    end if;

    if v_nota_tipo is null then
      raise exception 'Nota % no encontrada para este %.', p_id, v_etiqueta;
    end if;
    v_nota_ok := (p_tipo = 'nota_debito' and v_nota_tipo = 'debito')
              or (p_tipo = 'nota_credito' and v_nota_tipo = 'credito');
    if not v_nota_ok then
      raise exception 'La nota % no es de tipo %.', p_id, p_tipo;
    end if;
    if v_anulada then
      raise exception 'La nota % esta anulada y no se puede usar.', p_id;
    end if;
    if v_pagada then
      raise exception 'La nota % ya fue aplicada.', p_id;
    end if;
    if abs(round(p_monto, 2) - round(v_nota_mto, 2)) > 0.01 then
      raise exception 'La nota % se aplica completa (%), no por (%).', p_id, v_nota_mto, p_monto;
    end if;

    if p_es_proveedor then
      update public.notas_ajuste_proveedor set pagada = true, movimiento_id = p_movimiento_id where id = p_id;
    else
      update public.notas_ajuste_cliente set pagada = true, movimiento_id = p_movimiento_id where id = p_id;
    end if;

  elsif p_tipo = 'adelanto' then
    -- p_id = grupo_id del adelanto (o id del movimiento si es legacy sin grupo).
    select round(sum(coalesce(monto_usd, monto)), 2) into v_total
      from public.movimientos
     where (grupo_id = p_id or (grupo_id is null and id = p_id))
       and not anulado
       and subtipo = case when p_es_proveedor then 'adelanto' else 'anticipo' end
       and ((p_es_proveedor and proveedor_id = p_entidad_id)
         or (not p_es_proveedor and cliente_id = p_entidad_id));

    if v_total is null then
      raise exception 'Adelanto % no encontrado para este %.', p_id, v_etiqueta;
    end if;

    select coalesce(sum(monto_usd), 0) into v_aplicado
      from public.pago_aplicaciones where tipo = 'adelanto' and item_id = p_id and not anulada;

    if p_monto > round(v_total - v_aplicado, 2) + 0.01 then
      raise exception 'El adelanto % solo tiene % disponible (se intento aplicar %).',
        p_id, round(v_total - v_aplicado, 2), p_monto;
    end if;

  else
    raise exception 'Tipo de item desconocido: %', p_tipo;
  end if;

  insert into public.pago_aplicaciones (grupo_id, tipo, item_id, monto_usd)
  values (p_grupo_id, p_tipo, p_id, round(p_monto, 2));
end;
$function$;

create or replace function public._revertir_aplicaciones_grupo(p_es_proveedor boolean, p_grupo uuid)
returns int
language plpgsql
set search_path = public
as $$
declare
  ap record;
  v_total numeric; v_pagado numeric; v_estado text; v_nuevo numeric; v_filas int; v_n int := 0;
begin
  for ap in
    select a.tipo, a.item_id, a.monto_usd
      from public.pago_aplicaciones a
     where a.grupo_id = p_grupo and not a.anulada
     order by a.tipo, a.item_id
  loop
    v_n := v_n + 1;
    if ap.tipo = 'factura' then
      if p_es_proveedor then
        select total, monto_pagado, estado into v_total, v_pagado, v_estado
          from public.facturas_compra where id = ap.item_id for update;
      else
        select total, monto_pagado, estado into v_total, v_pagado, v_estado
          from public.facturas_venta where id = ap.item_id for update;
      end if;
      if v_total is null then
        raise exception 'La factura aplicada (%) ya no existe: no se puede revertir.', ap.item_id;
      end if;
      v_nuevo := round(coalesce(v_pagado, 0) - ap.monto_usd, 2);
      if v_nuevo < -0.01 then
        raise exception 'No se puede revertir: la factura % quedaria con pagos negativos (pagado %, a revertir %). Revisa sus otros pagos.',
          ap.item_id, coalesce(v_pagado, 0), ap.monto_usd;
      end if;
      v_nuevo := greatest(v_nuevo, 0);
      -- Una factura anulada no cuenta en el saldo y un trigger impide tocarla:
      -- se deja como esta (la aplicacion igual queda revertida/anulada).
      if v_estado <> 'anulada' then
        if p_es_proveedor then
          update public.facturas_compra
             set monto_pagado = v_nuevo,
                 estado = case when estado = 'pagada' and v_nuevo < total - 0.01 then 'emitida' else estado end
           where id = ap.item_id;
        else
          update public.facturas_venta
             set monto_pagado = v_nuevo,
                 estado = case when estado = 'pagada' and v_nuevo < total - 0.01 then 'emitida' else estado end
           where id = ap.item_id;
        end if;
      end if;

    elsif ap.tipo in ('nota_debito', 'nota_credito') then
      if p_es_proveedor then
        update public.notas_ajuste_proveedor set pagada = false, movimiento_id = null
         where id = ap.item_id and pagada = true;
      else
        update public.notas_ajuste_cliente set pagada = false, movimiento_id = null
         where id = ap.item_id and pagada = true;
      end if;
      get diagnostics v_filas = row_count;
      if v_filas = 0 then
        raise exception 'La nota % ya no figura como aplicada: no se puede revertir.', ap.item_id;
      end if;
    end if;
  end loop;
  return v_n;
end;
$$;

create or replace function public.anular_nota_ajuste_proveedor(
  p_nota_id uuid, p_motivo text, p_registrado_por uuid
) returns uuid
language plpgsql
as $function$
declare
  v_encontrada boolean;
  v_anulada    boolean;
  v_pagada     boolean;
  v_mov_id     uuid;
  v_mov_num    bigint;
  v_mov_sub    text;
  v_ref        text;
begin
  select true, anulada, pagada, movimiento_id
    into v_encontrada, v_anulada, v_pagada, v_mov_id
    from public.notas_ajuste_proveedor
   where id = p_nota_id
   for update;

  if v_encontrada is not true then
    raise exception 'Nota no encontrada.';
  end if;
  if v_anulada then
    raise exception 'Esta nota ya fue anulada.';
  end if;
  if v_pagada then
    select numero, subtipo into v_mov_num, v_mov_sub
      from public.movimientos where id = v_mov_id;
    v_ref := case
      when v_mov_num is not null then ' (PG-' || lpad(v_mov_num::text, 4, '0') || ')'
      else ''
    end;
    raise exception 'Esta nota ya fue aplicada en un pago%: no se puede anular sin reversar antes ese pago.', v_ref;
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'El motivo de la anulación es obligatorio.';
  end if;

  update public.notas_ajuste_proveedor
     set anulada = true,
         anulada_at = now(),
         anulada_por = p_registrado_por,
         anulada_motivo = btrim(p_motivo)
   where id = p_nota_id;

  return p_nota_id;
end;
$function$;

create or replace function public.anular_nota_ajuste_cliente(
  p_nota_id uuid, p_motivo text, p_registrado_por uuid
) returns uuid
language plpgsql
as $function$
declare
  v_encontrada boolean;
  v_anulada    boolean;
  v_pagada     boolean;
  v_mov_id     uuid;
  v_mov_num    bigint;
  v_ref        text;
begin
  select true, anulada, pagada, movimiento_id
    into v_encontrada, v_anulada, v_pagada, v_mov_id
    from public.notas_ajuste_cliente
   where id = p_nota_id
   for update;

  if v_encontrada is not true then
    raise exception 'Nota no encontrada.';
  end if;
  if v_anulada then
    raise exception 'Esta nota ya fue anulada.';
  end if;
  if v_pagada then
    select numero into v_mov_num from public.movimientos where id = v_mov_id;
    v_ref := case
      when v_mov_num is not null then ' (CB-' || lpad(v_mov_num::text, 4, '0') || ')'
      else ''
    end;
    raise exception 'Esta nota ya fue aplicada en un cobro%: no se puede anular sin reversar antes ese cobro.', v_ref;
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'El motivo de la anulación es obligatorio.';
  end if;

  update public.notas_ajuste_cliente
     set anulada = true,
         anulada_at = now(),
         anulada_por = p_registrado_por,
         anulada_motivo = btrim(p_motivo)
   where id = p_nota_id;

  return p_nota_id;
end;
$function$;

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

create or replace function public.asignar_correlativo_movimiento()
returns trigger
language plpgsql
as $$
begin
  if new.numero is null then
    if new.subtipo = 'pago' then
      new.numero := nextval('public.movimientos_pago_numero_seq');
    elsif new.subtipo = 'adelanto' then
      new.numero := nextval('public.movimientos_adelanto_numero_seq');
    end if;
  end if;
  return new;
end;
$$;

commit;

notify pgrst, 'reload schema';
