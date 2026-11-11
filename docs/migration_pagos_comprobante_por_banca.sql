-- =============================================================================
-- Pago/cobro repartido entre varias bancas: cada banca guarda SU comprobante (foto)
-- =============================================================================
-- Problema: un pago o cobro con varias bancas dejaba UN solo juego de comprobantes, colgado del movimiento principal
-- (aplicar_pasos_pago, docs/migration_idempotencia_pagos_cobros.sql). Con dos o más cuentas no se sabía qué foto
-- correspondía a cuál.
--
-- Qué hace (aditivo; no cambia tablas ni datos existentes):
--   1. _unir_comprobantes(a, b): une dos listas jsonb de URLs sin repetir y respetando el orden de aparición.
--   2. aplicar_pasos_pago(...) gana un 8.º parámetro opcional `p_bancas jsonb` (la misma lista de bancas que recibe la RPC
--      de dinero; cada elemento puede traer `comprobantes: [url, ...]`). Reparto:
--        * los comprobantes de una banca van al movimiento de ESA banca: el «pago»/«cobro» y, si la cuenta solo tiene
--          adelanto/anticipo, ese movimiento (igual que la comisión bancaria);
--        * los comprobantes generales (`p_comprobantes`) siguen yendo al movimiento principal, junto a los propios de su banca;
--        * sin comprobantes por banca el resultado es idéntico al de antes (compatibilidad total).
--      Cada movimiento se actualiza en su propio sub-bloque: si falla, NO revierte el dinero y se anota en
--      pagos_pasos_pendientes (paso 'comprobante', detalle {movimientoId, comprobantes}: el reintento del backend ya lo
--      entiende). Devuelve además `comprobantesPorBanca` (cuántas bancas recibieron los suyos): así el backend sabe que esta
--      versión está aplicada y, si falta, reparte los comprobantes él mismo.
--   3. Los envoltorios registrar_pago_proveedor_multi_banca_completo y registrar_cobro_cliente_multi_banca_completo
--      pasan `p_bancas` a aplicar_pasos_pago. El de pago simple no cambia (una sola banca: el comprobante general basta).
--   La versión de 7 parámetros de aplicar_pasos_pago se elimina (si no, la llamada de 7 argumentos sería ambigua).
--
-- Requisitos: migration_idempotencia_pagos_cobros.sql (y sus requisitos). Seguro de repetir.
-- ORDEN: aplicar DESPUÉS de migration_idempotencia_pagos_cobros.sql y antes o junto al backend nuevo. NO volver a aplicar
-- migration_idempotencia_pagos_cobros.sql después de esta (recrearía la versión de 7 parámetros y los envoltorios anteriores).
-- ROLLBACK: docs/migration_pagos_comprobante_por_banca_ROLLBACK.sql (los comprobantes ya repartidos quedan donde están).
-- Hacer backup antes de aplicar. NO se aplica sola.
-- =============================================================================

begin;

do $$
begin
  if to_regprocedure('public.aplicar_pasos_pago(uuid[], uuid, uuid, uuid, jsonb, uuid[], uuid)') is null
     and to_regprocedure('public.aplicar_pasos_pago(uuid[], uuid, uuid, uuid, jsonb, uuid[], uuid, jsonb)') is null then
    raise exception 'Falta aplicar docs/migration_idempotencia_pagos_cobros.sql antes de esta migración.';
  end if;
  if to_regclass('public.pagos_pasos_pendientes') is null then
    raise exception 'Falta aplicar docs/migration_pagos_pasos_pendientes.sql.';
  end if;
end $$;

-- 1. Unión de listas de URLs (orden de aparición, sin repetidos) --------------------------------------------------
create or replace function public._unir_comprobantes(p_a jsonb, p_b jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by o), '[]'::jsonb)
    from (
      select t.x, min(t.o) as o
        from jsonb_array_elements(
               case when jsonb_typeof(p_a) = 'array' then p_a else '[]'::jsonb end
            || case when jsonb_typeof(p_b) = 'array' then p_b else '[]'::jsonb end
             ) with ordinality as t(x, o)
       group by t.x
    ) u;
$$;

-- 2. Pasos posteriores con comprobantes por banca ----------------------------------------------------------------
drop function if exists public.aplicar_pasos_pago(uuid[], uuid, uuid, uuid, jsonb, uuid[], uuid);

create or replace function public.aplicar_pasos_pago(
  p_movimiento_ids       uuid[],
  p_principal_id         uuid,
  p_grupo_id             uuid,
  p_categoria_id         uuid,
  p_comprobantes         jsonb,
  p_bancas_con_comision  uuid[],
  p_usuario              uuid,
  p_bancas               jsonb default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_pendientes jsonb := '[]'::jsonb;
  v_comisiones jsonb := '[]'::jsonb;
  v_reparto    jsonb := '{}'::jsonb;   -- movimiento_id (texto) -> lista de URLs que le tocan
  v_n_bancas   int   := 0;
  v_id         uuid;
  v_banca      uuid;
  v_mov        uuid;
  v_res        jsonb;
  v_el         jsonb;
  v_dest       uuid;
  v_clave      text;
  v_urls       jsonb;
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

  -- Comprobantes: los de cada banca al movimiento de esa banca (el «pago»/«cobro» antes que el adelanto/anticipo)...
  if p_bancas is not null and jsonb_typeof(p_bancas) = 'array' and coalesce(array_length(p_movimiento_ids, 1), 0) > 0 then
    for v_el in select value from jsonb_array_elements(p_bancas) as elems(value)
    loop
      v_urls := v_el->'comprobantes';
      if v_urls is null or jsonb_typeof(v_urls) <> 'array' or jsonb_array_length(v_urls) = 0 then
        continue;
      end if;
      select id into v_dest
        from public.movimientos
       where id = any(p_movimiento_ids) and banca_origen_id = (v_el->>'bancaId')::uuid
       order by coalesce(subtipo in ('pago', 'cobro'), false) desc, id
       limit 1;
      if v_dest is null then
        continue;
      end if;
      v_reparto := jsonb_set(v_reparto, array[v_dest::text],
                             public._unir_comprobantes(v_reparto->(v_dest::text), v_urls));
      v_n_bancas := v_n_bancas + 1;
    end loop;
  end if;

  -- ...y los generales al movimiento principal, junto a los propios de su banca.
  if p_principal_id is not null and p_comprobantes is not null and jsonb_typeof(p_comprobantes) = 'array'
     and jsonb_array_length(p_comprobantes) > 0 then
    v_reparto := jsonb_set(v_reparto, array[p_principal_id::text],
                           public._unir_comprobantes(v_reparto->(p_principal_id::text), p_comprobantes));
  end if;

  for v_clave in select jsonb_object_keys(v_reparto)
  loop
    begin
      update public.movimientos set comprobantes = v_reparto->v_clave where id = v_clave::uuid;
    exception when others then
      insert into public.pagos_pasos_pendientes (grupo_id, movimiento_id, paso, detalle, error)
      values (p_grupo_id, v_clave::uuid, 'comprobante',
              jsonb_build_object('movimientoId', v_clave, 'comprobantes', v_reparto->v_clave), sqlerrm)
      returning id into v_id;
      v_pendientes := v_pendientes || jsonb_build_object('id', v_id, 'paso', 'comprobante');
    end;
  end loop;

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

  return jsonb_build_object('comisiones', v_comisiones, 'pasosPendientes', v_pendientes, 'comprobantesPorBanca', v_n_bancas);
end;
$$;

-- 3. Envoltorios multi-banca: pasan las bancas (con sus comprobantes) a los pasos -------------------------------------
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
    p_bancas_con_comision, p_registrado_por, p_bancas);
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
    '{}'::uuid[], p_registrado_por, p_bancas);
  v_res := v_res || v_pasos;

  if p_client_request_id is not null then
    update public.operaciones_cliente set entidad_id = v_grupo, resultado = v_res
     where client_request_id = p_client_request_id;
  end if;
  return v_res;
end;
$$;

-- 4. Permisos: solo el backend (service_role) ---------------------------------------------------------------------
revoke all on function public._unir_comprobantes(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.aplicar_pasos_pago(uuid[], uuid, uuid, uuid, jsonb, uuid[], uuid, jsonb)
  from public, anon, authenticated;

grant execute on function public._unir_comprobantes(jsonb, jsonb) to service_role;
grant execute on function public.aplicar_pasos_pago(uuid[], uuid, uuid, uuid, jsonb, uuid[], uuid, jsonb) to service_role;

commit;
