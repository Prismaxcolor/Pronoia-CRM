-- ROLLBACK de docs/migration_pagos_comprobante_por_banca.sql
-- Vuelve a la versión de 7 parámetros de aplicar_pasos_pago y a los envoltorios multi-banca anteriores (los comprobantes
-- van solo al movimiento principal). Los comprobantes ya repartidos entre movimientos NO se tocan: siguen guardados en cada
-- movimiento y el detalle del pago los sigue leyendo; solo los pagos nuevos vuelven al comportamiento anterior.
-- Si se revierte también docs/migration_idempotencia_pagos_cobros.sql, hacerlo DESPUÉS de este archivo.
begin;

drop function if exists public.aplicar_pasos_pago(uuid[], uuid, uuid, uuid, jsonb, uuid[], uuid, jsonb);
drop function if exists public._unir_comprobantes(jsonb, jsonb);

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

revoke all on function public.aplicar_pasos_pago(uuid[], uuid, uuid, uuid, jsonb, uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.aplicar_pasos_pago(uuid[], uuid, uuid, uuid, jsonb, uuid[], uuid) to service_role;

commit;
