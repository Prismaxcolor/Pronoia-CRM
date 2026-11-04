-- =============================================================================
-- Pagos y cobros: «una sola vez» y pasos posteriores dentro de la MISMA transacción
-- =============================================================================
-- Problema: POST /api/pagos, /api/pagos/multiple y /api/cobros/multiple movían el dinero con una RPC y, DESPUÉS y
-- por separado, el backend ponía la categoría, guardaba las fotos del comprobante y cargaba la comisión bancaria. Un
-- corte entre ambos dejaba el pago sin esos pasos y sin rastro; un reintento por timeout podía repetir el pago.
--
-- Qué hace (aditivo; NO modifica las RPC existentes, solo las envuelve):
--   1. aplicar_pasos_pago(...): aplica categoría, comprobantes y comisión bancaria sobre el pago recién creado. Cada
--      paso va en su propio sub-bloque: si uno falla NO revierte el dinero, se anota en pagos_pasos_pendientes
--      (docs/migration_pagos_pasos_pendientes.sql) y se informa en `pasosPendientes` para el reintento del backend.
--   2. Envoltorios *_completo, uno por RPC de dinero. En UNA transacción: candado por clientRequestId -> si ya hay un
--      resultado guardado en operaciones_cliente lo devuelve (no repite nada) -> RPC original -> aplicar_pasos_pago
--      -> guarda resultado y entidad_id en operaciones_cliente. Si el servidor cae en cualquier punto, o se
--      guardó todo o no se guardó nada: un reintento nunca duplica el pago.
--        registrar_pago_proveedor_completo              (POST /api/pagos)
--        registrar_pago_proveedor_multi_banca_completo  (POST /api/pagos/multiple)
--        registrar_cobro_cliente_multi_banca_completo   (POST /api/cobros/multiple)
--      p_client_request_id puede ser null (cliente viejo sin clave): entonces solo se agregan los pasos atómicos.
--   Permisos: revoke a public/anon/authenticated, grant a service_role.
--
-- Requisitos (se comprueban abajo): migration_operaciones_cliente.sql, migration_pagos_pasos_pendientes.sql,
-- migration_cruce_pagos_fixes.sql (RPC de pago/cobro), migration_wallet_categorias.sql (movimientos.categoria_id).
-- La comisión usa agregar_comision_bancaria_a_pago (migration_pago_comision_bancaria.sql): solo se invoca si el
-- backend pide comisión; si falta, ese paso queda pendiente sin afectar el pago.
--
-- ORDEN DE APLICACIÓN: 1) migration_pagos_pasos_pendientes.sql  2) ESTA.
-- El backend tolera que no esté aplicada: sin los envoltorios usa el flujo anterior (RPC + pasos en el backend).
-- Seguro de repetir (create or replace). ROLLBACK: docs/migration_idempotencia_pagos_cobros_ROLLBACK.sql.
-- Hacer backup antes de aplicar. NO se aplica sola.
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.operaciones_cliente') is null then
    raise exception 'Falta aplicar docs/migration_operaciones_cliente.sql.';
  end if;
  if to_regclass('public.pagos_pasos_pendientes') is null then
    raise exception 'Falta aplicar docs/migration_pagos_pasos_pendientes.sql antes de esta migración.';
  end if;
  if to_regprocedure('public.registrar_pago_proveedor(uuid, uuid, numeric, text, numeric, text, text, date, uuid, uuid)') is null
     or to_regprocedure('public.registrar_pago_proveedor_multi_banca(uuid, jsonb, numeric, text, text, date, uuid, jsonb)') is null
     or to_regprocedure('public.registrar_cobro_cliente_multi_banca(uuid, jsonb, numeric, text, text, date, uuid, jsonb)') is null then
    raise exception 'Faltan las RPC de pago/cobro (docs/migration_cruce_pagos_fixes.sql).';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'movimientos' and column_name = 'categoria_id') then
    raise exception 'Falta aplicar docs/migration_wallet_categorias.sql (columna movimientos.categoria_id).';
  end if;
end $$;

-- 1. Pasos posteriores: categoría, comprobantes y comisión, cada uno aislado ------------------------------------
create or replace function public.aplicar_pasos_pago(
  p_movimiento_ids       uuid[],
  p_principal_id         uuid,
  p_grupo_id             uuid,
  p_categoria_id         uuid,
  p_comprobantes         jsonb,
  p_bancas_con_comision  uuid[],
  p_usuario              uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_pendientes jsonb := '[]'::jsonb;
  v_comisiones jsonb := '[]'::jsonb;
  v_id         uuid;
  v_banca      uuid;
  v_mov        uuid;
  v_res        jsonb;
begin
  -- Categoría del Wallet en todos los movimientos de dinero (pago/cobro y adelanto/anticipo).
  if p_categoria_id is not null and coalesce(array_length(p_movimiento_ids, 1), 0) > 0 then
    begin
      update public.movimientos set categoria_id = p_categoria_id where id = any(p_movimiento_ids);
    exception when others then
      insert into public.pagos_pasos_pendientes (grupo_id, movimiento_id, paso, detalle, error)
      values (p_grupo_id, p_principal_id, 'categoria',
              jsonb_build_object('movimientoIds', to_jsonb(p_movimiento_ids), 'categoriaId', p_categoria_id), sqlerrm)
      returning id into v_id;
      v_pendientes := v_pendientes || jsonb_build_object('id', v_id, 'paso', 'categoria');
    end;
  end if;

  -- Fotos del comprobante en el movimiento principal.
  if p_principal_id is not null and p_comprobantes is not null and jsonb_array_length(p_comprobantes) > 0 then
    begin
      update public.movimientos set comprobantes = p_comprobantes where id = p_principal_id;
    exception when others then
      insert into public.pagos_pasos_pendientes (grupo_id, movimiento_id, paso, detalle, error)
      values (p_grupo_id, p_principal_id, 'comprobante',
              jsonb_build_object('movimientoId', p_principal_id, 'comprobantes', p_comprobantes), sqlerrm)
      returning id into v_id;
      v_pendientes := v_pendientes || jsonb_build_object('id', v_id, 'paso', 'comprobante');
    end;
  end if;

  -- Comisión bancaria: un cargo por cada cuenta en Bs donde la persona eligió Sí, colgado del movimiento «pago» de esa
  -- cuenta (o del primero, si solo hay adelanto), igual que el backend.
  foreach v_banca in array coalesce(p_bancas_con_comision, '{}'::uuid[]) loop
    begin
      select id into v_mov
        from public.movimientos
       where id = any(p_movimiento_ids) and banca_origen_id = v_banca
       order by coalesce(subtipo = 'pago', false) desc, id
       limit 1;
      if v_mov is null then
        raise exception 'No se encontró el movimiento de la cuenta % para cargar la comisión.', v_banca;
      end if;
      v_res := public.agregar_comision_bancaria_a_pago(v_mov, p_usuario);
      v_comisiones := v_comisiones || jsonb_build_object(
        'bancaId', v_banca, 'movimientoId', v_res->>'comisionId', 'monto', (v_res->>'comision')::numeric);
    exception when others then
      insert into public.pagos_pasos_pendientes (grupo_id, movimiento_id, paso, detalle, error)
      values (p_grupo_id, p_principal_id, 'comision',
              jsonb_build_object('movimientoIds', to_jsonb(p_movimiento_ids), 'grupoId', p_grupo_id,
                                 'bancaId', v_banca, 'usuarioId', p_usuario), sqlerrm)
      returning id into v_id;
      v_pendientes := v_pendientes || jsonb_build_object('id', v_id, 'paso', 'comision');
    end;
  end loop;

  return jsonb_build_object('comisiones', v_comisiones, 'pasosPendientes', v_pendientes);
end;
$$;

-- 2. Pago a proveedor (una banca) ---------------------------------------------------------------------------------
create or replace function public.registrar_pago_proveedor_completo(
  p_client_request_id    uuid,
  p_proveedor_id         uuid,
  p_banca_id             uuid,
  p_monto                numeric,
  p_moneda               text,
  p_monto_usd            numeric,
  p_descripcion          text,
  p_referencia           text,
  p_fecha                date,
  p_registrado_por       uuid,
  p_factura_id           uuid,
  p_categoria_id         uuid default null,
  p_comprobantes         jsonb default null,
  p_con_comision         boolean default false
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_previo jsonb;
  v_mov_id uuid;
  v_grupo  uuid;
  v_pasos  jsonb;
  v_res    jsonb;
begin
  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('pago_completo:' || p_client_request_id::text, 0));
    select resultado into v_previo from public.operaciones_cliente
     where client_request_id = p_client_request_id and entidad_id is not null;
    if v_previo is not null then
      return v_previo;
    end if;
  end if;

  v_mov_id := public.registrar_pago_proveedor(
    p_proveedor_id, p_banca_id, p_monto, p_moneda, p_monto_usd, p_descripcion, p_referencia, p_fecha,
    p_registrado_por, p_factura_id);
  select coalesce(grupo_id, id) into v_grupo from public.movimientos where id = v_mov_id;

  v_pasos := public.aplicar_pasos_pago(
    array[v_mov_id], v_mov_id, v_grupo, p_categoria_id, p_comprobantes,
    case when p_con_comision then array[p_banca_id] else '{}'::uuid[] end, p_registrado_por);
  v_res := jsonb_build_object('movimientoId', v_mov_id, 'grupoId', v_grupo) || v_pasos;

  if p_client_request_id is not null then
    update public.operaciones_cliente set entidad_id = v_mov_id, resultado = v_res
     where client_request_id = p_client_request_id;
  end if;
  return v_res;
end;
$$;

-- 3. Pago combinado a proveedor ---------------------------------------------------------------------------------
create or replace function public.registrar_pago_proveedor_multi_banca_completo(
  p_client_request_id    uuid,
  p_proveedor_id         uuid,
  p_bancas               jsonb,
  p_monto_usd            numeric,
  p_descripcion          text,
  p_referencia           text,
  p_fecha                date,
  p_registrado_por       uuid,
  p_items                jsonb,
  p_categoria_id         uuid default null,
  p_comprobantes         jsonb default null,
  p_bancas_con_comision  uuid[] default '{}'
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_previo jsonb;
  v_res    jsonb;
  v_ids    uuid[];
  v_grupo  uuid;
  v_pasos  jsonb;
begin
  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('pago_completo:' || p_client_request_id::text, 0));
    select resultado into v_previo from public.operaciones_cliente
     where client_request_id = p_client_request_id and entidad_id is not null;
    if v_previo is not null then
      return v_previo;
    end if;
  end if;

  v_res := public.registrar_pago_proveedor_multi_banca(
    p_proveedor_id, p_bancas, p_monto_usd, p_descripcion, p_referencia, p_fecha, p_registrado_por, p_items);
  v_ids := array(select x::uuid from jsonb_array_elements_text(coalesce(v_res->'movimientoIds', '[]'::jsonb)) x);
  v_grupo := (v_res->>'grupoId')::uuid;

  v_pasos := public.aplicar_pasos_pago(
    v_ids, nullif(v_res->>'movimientoPrincipalId', '')::uuid, v_grupo, p_categoria_id, p_comprobantes,
    p_bancas_con_comision, p_registrado_por);
  v_res := v_res || v_pasos;

  if p_client_request_id is not null then
    update public.operaciones_cliente set entidad_id = v_grupo, resultado = v_res
     where client_request_id = p_client_request_id;
  end if;
  return v_res;
end;
$$;

-- 4. Cobro combinado a cliente (sin comisión bancaria) ---------------------------------------------------------
create or replace function public.registrar_cobro_cliente_multi_banca_completo(
  p_client_request_id    uuid,
  p_cliente_id           uuid,
  p_bancas               jsonb,
  p_monto_usd            numeric,
  p_descripcion          text,
  p_referencia           text,
  p_fecha                date,
  p_registrado_por       uuid,
  p_items                jsonb,
  p_categoria_id         uuid default null,
  p_comprobantes         jsonb default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_previo jsonb;
  v_res    jsonb;
  v_ids    uuid[];
  v_grupo  uuid;
  v_pasos  jsonb;
begin
  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('cobro_completo:' || p_client_request_id::text, 0));
    select resultado into v_previo from public.operaciones_cliente
     where client_request_id = p_client_request_id and entidad_id is not null;
    if v_previo is not null then
      return v_previo;
    end if;
  end if;

  v_res := public.registrar_cobro_cliente_multi_banca(
    p_cliente_id, p_bancas, p_monto_usd, p_descripcion, p_referencia, p_fecha, p_registrado_por, p_items);
  v_ids := array(select x::uuid from jsonb_array_elements_text(coalesce(v_res->'movimientoIds', '[]'::jsonb)) x);
  v_grupo := (v_res->>'grupoId')::uuid;

  v_pasos := public.aplicar_pasos_pago(
    v_ids, nullif(v_res->>'movimientoPrincipalId', '')::uuid, v_grupo, p_categoria_id, p_comprobantes,
    '{}'::uuid[], p_registrado_por);
  v_res := v_res || v_pasos;

  if p_client_request_id is not null then
    update public.operaciones_cliente set entidad_id = v_grupo, resultado = v_res
     where client_request_id = p_client_request_id;
  end if;
  return v_res;
end;
$$;

-- 5. Permisos: solo el backend (service_role) ---------------------------------------------------------------------
revoke all on function public.aplicar_pasos_pago(uuid[], uuid, uuid, uuid, jsonb, uuid[], uuid)
  from public, anon, authenticated;
revoke all on function public.registrar_pago_proveedor_completo(uuid, uuid, uuid, numeric, text, numeric, text, text, date, uuid, uuid, uuid, jsonb, boolean)
  from public, anon, authenticated;
revoke all on function public.registrar_pago_proveedor_multi_banca_completo(uuid, uuid, jsonb, numeric, text, text, date, uuid, jsonb, uuid, jsonb, uuid[])
  from public, anon, authenticated;
revoke all on function public.registrar_cobro_cliente_multi_banca_completo(uuid, uuid, jsonb, numeric, text, text, date, uuid, jsonb, uuid, jsonb)
  from public, anon, authenticated;

grant execute on function public.aplicar_pasos_pago(uuid[], uuid, uuid, uuid, jsonb, uuid[], uuid) to service_role;
grant execute on function public.registrar_pago_proveedor_completo(uuid, uuid, uuid, numeric, text, numeric, text, text, date, uuid, uuid, uuid, jsonb, boolean) to service_role;
grant execute on function public.registrar_pago_proveedor_multi_banca_completo(uuid, uuid, jsonb, numeric, text, text, date, uuid, jsonb, uuid, jsonb, uuid[]) to service_role;
grant execute on function public.registrar_cobro_cliente_multi_banca_completo(uuid, uuid, jsonb, numeric, text, text, date, uuid, jsonb, uuid, jsonb) to service_role;

commit;
