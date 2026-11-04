-- =============================================================================
-- Modo sin conexión (Fase 4): "una sola fila" garantizada por la BASE DE DATOS
-- =============================================================================
-- Continúa docs/migration_operaciones_cliente.sql (Fase 3), que YA está aplicada: NO recrea
-- operaciones_cliente ni reclamar_operacion_cliente. Aquí se extiende la misma garantía a lo que
-- la cola envía en la Fase 4: toma física, conteos, altas de maestros, transformaciones y packing list.
--
-- Contenido (todo aditivo; ninguna función ni dato existente se modifica):
--   1. Columnas client_request_id (uuid) y capturado_en (timestamptz) + índice ÚNICO PARCIAL
--      (where client_request_id is not null) en:
--        tomas_fisicas_inventario, detalle_toma_fisica (conteos), proveedores, clientes, productos,
--        taras, almacenes, vehiculos, transformaciones, packing_lists.
--   2. Funciones envoltorio *_idem para las creaciones que pasan por RPC. Dentro de UNA transacción:
--      candado por clave -> si ya existe fila con esa clave devuelve la existente -> si no, llama al
--      RPC original (sin tocarlo) y marca la fila creada. Si el servidor cae en cualquier punto la
--      transacción se revierte entera (nada a medias); el índice único es la red final:
--        crear_toma_fisica_inventario_idem        (crear toma física)
--        registrar_pesaje_toma_fisica_idem        (conteo de toma física)
--        crear_transformacion_ferroso_idem
--        crear_transformacion_pcb_idem            (versión con p_almacen_id, la que usa el backend)
--        guardar_packing_list_idem                (solo al CREAR; editar ya lo protege la versión)
--      Permisos: revoke a public/anon/authenticated, grant a service_role.
--   3. Altas de maestros (proveedor, cliente, producto, tara, almacén, vehículo): son inserts directos;
--      basta el índice único. El servicio, con clientRequestId, busca primero la fila por esa clave,
--      inserta con la clave y, si otro intento ganó la carrera (23505 sobre la clave), devuelve la fila
--      existente (equivale a ON CONFLICT DO NOTHING + leer; con índice PARCIAL ON CONFLICT no puede
--      inferirlo desde PostgREST, por eso el servicio lo resuelve así).
--
-- No necesitan envoltorio (comprobado con pg_get_functiondef, solo lectura):
--   * completar_transformacion_ferroso / _pcb / _mixta: bloquean la fila (for update) y lanzan
--     "ya está completa" / "Esta transformación ya fue completada." si estado <> 'bruto'. Repetirlas no duplica.
--   * guardar_packing_list al EDITAR: exige p_version_esperada y lanza PL409 si la versión ya cambió;
--     repetir una edición ya aplicada no puede aplicarla dos veces.
--
-- CÓMO APLICAR: Supabase Studio -> SQL Editor. Seguro de repetir (if not exists / create or replace).
-- El backend tolera que no esté aplicada: sin los envoltorios/columnas usa el comportamiento anterior.
-- ROLLBACK al final (comentado).
-- =============================================================================

-- 1. Columnas e índices únicos parciales -------------------------------------------------
alter table public.tomas_fisicas_inventario add column if not exists client_request_id uuid;
alter table public.tomas_fisicas_inventario add column if not exists capturado_en timestamptz;
alter table public.detalle_toma_fisica      add column if not exists client_request_id uuid;
alter table public.detalle_toma_fisica      add column if not exists capturado_en timestamptz;
alter table public.proveedores              add column if not exists client_request_id uuid;
alter table public.proveedores              add column if not exists capturado_en timestamptz;
alter table public.clientes                 add column if not exists client_request_id uuid;
alter table public.clientes                 add column if not exists capturado_en timestamptz;
alter table public.productos                add column if not exists client_request_id uuid;
alter table public.productos                add column if not exists capturado_en timestamptz;
alter table public.taras                    add column if not exists client_request_id uuid;
alter table public.taras                    add column if not exists capturado_en timestamptz;
alter table public.almacenes                add column if not exists client_request_id uuid;
alter table public.almacenes                add column if not exists capturado_en timestamptz;
alter table public.vehiculos                add column if not exists client_request_id uuid;
alter table public.vehiculos                add column if not exists capturado_en timestamptz;
alter table public.transformaciones         add column if not exists client_request_id uuid;
alter table public.transformaciones         add column if not exists capturado_en timestamptz;
alter table public.packing_lists            add column if not exists client_request_id uuid;
alter table public.packing_lists            add column if not exists capturado_en timestamptz;

create unique index if not exists uq_tomas_fisicas_client_request_id
  on public.tomas_fisicas_inventario (client_request_id) where client_request_id is not null;
create unique index if not exists uq_detalle_toma_fisica_client_request_id
  on public.detalle_toma_fisica (client_request_id) where client_request_id is not null;
create unique index if not exists uq_proveedores_client_request_id
  on public.proveedores (client_request_id) where client_request_id is not null;
create unique index if not exists uq_clientes_client_request_id
  on public.clientes (client_request_id) where client_request_id is not null;
create unique index if not exists uq_productos_client_request_id
  on public.productos (client_request_id) where client_request_id is not null;
create unique index if not exists uq_taras_client_request_id
  on public.taras (client_request_id) where client_request_id is not null;
create unique index if not exists uq_almacenes_client_request_id
  on public.almacenes (client_request_id) where client_request_id is not null;
create unique index if not exists uq_vehiculos_client_request_id
  on public.vehiculos (client_request_id) where client_request_id is not null;
create unique index if not exists uq_transformaciones_client_request_id
  on public.transformaciones (client_request_id) where client_request_id is not null;
create unique index if not exists uq_packing_lists_client_request_id
  on public.packing_lists (client_request_id) where client_request_id is not null;

-- 2. Envoltorios *_idem ------------------------------------------------------------------------
create or replace function public.crear_toma_fisica_inventario_idem(
  p_client_request_id uuid, p_capturado_en timestamptz,
  p_almacen_id uuid, p_categorias uuid[], p_descripcion text, p_abierta_por uuid,
  p_lote_ids uuid[], p_producto_ids uuid[]
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('crear_toma_fisica:' || p_client_request_id::text, 0));

  select id into v_id from public.tomas_fisicas_inventario where client_request_id = p_client_request_id;
  if v_id is not null then
    return v_id;
  end if;

  v_id := public.crear_toma_fisica_inventario(
    p_almacen_id, p_categorias, p_descripcion, p_abierta_por, p_lote_ids, p_producto_ids
  );

  update public.tomas_fisicas_inventario
     set client_request_id = p_client_request_id, capturado_en = p_capturado_en
   where id = v_id;
  return v_id;
end;
$$;

create or replace function public.registrar_pesaje_toma_fisica_idem(
  p_client_request_id uuid, p_capturado_en timestamptz,
  p_toma_fisica_id uuid, p_producto_id uuid, p_lote_id uuid,
  p_peso_bruto numeric, p_tara numeric, p_fotos text[], p_registrado_por uuid
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('registrar_pesaje_toma_fisica:' || p_client_request_id::text, 0));

  select id into v_id from public.detalle_toma_fisica where client_request_id = p_client_request_id;
  if v_id is not null then
    return v_id;
  end if;

  v_id := public.registrar_pesaje_toma_fisica(
    p_toma_fisica_id, p_producto_id, p_lote_id, p_peso_bruto, p_tara, p_fotos, p_registrado_por
  );

  update public.detalle_toma_fisica
     set client_request_id = p_client_request_id, capturado_en = p_capturado_en
   where id = v_id;
  return v_id;
end;
$$;

create or replace function public.crear_transformacion_ferroso_idem(
  p_client_request_id uuid, p_capturado_en timestamptz,
  p_producto_entrada_id uuid, p_almacen_id uuid, p_peso_bruto numeric, p_tara numeric,
  p_fecha date, p_notas text, p_fotos_entrada text[], p_registrado_por uuid
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('crear_transformacion:' || p_client_request_id::text, 0));

  select id into v_id from public.transformaciones where client_request_id = p_client_request_id;
  if v_id is not null then
    return v_id;
  end if;

  v_id := public.crear_transformacion_ferroso(
    p_producto_entrada_id, p_almacen_id, p_peso_bruto, p_tara, p_fecha, p_notas, p_fotos_entrada, p_registrado_por
  );

  update public.transformaciones
     set client_request_id = p_client_request_id, capturado_en = p_capturado_en
   where id = v_id;
  return v_id;
end;
$$;

create or replace function public.crear_transformacion_pcb_idem(
  p_client_request_id uuid, p_capturado_en timestamptz,
  p_lote_origen_id uuid, p_peso_bruto numeric, p_tara numeric, p_fecha date, p_notas text,
  p_fotos_entrada text[], p_registrado_por uuid, p_almacen_id uuid
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('crear_transformacion:' || p_client_request_id::text, 0));

  select id into v_id from public.transformaciones where client_request_id = p_client_request_id;
  if v_id is not null then
    return v_id;
  end if;

  v_id := public.crear_transformacion_pcb(
    p_lote_origen_id, p_peso_bruto, p_tara, p_fecha, p_notas, p_fotos_entrada, p_registrado_por, p_almacen_id
  );

  update public.transformaciones
     set client_request_id = p_client_request_id, capturado_en = p_capturado_en
   where id = v_id;
  return v_id;
end;
$$;

-- Solo para CREAR (p_id null). Devuelve {id, version} igual que guardar_packing_list.
create or replace function public.guardar_packing_list_idem(
  p_client_request_id uuid, p_capturado_en timestamptz,
  p_cabecera jsonb, p_items jsonb, p_usuario uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_id        uuid;
  v_version   integer;
  v_resultado jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('guardar_packing_list:' || p_client_request_id::text, 0));

  select id, version into v_id, v_version from public.packing_lists where client_request_id = p_client_request_id;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'version', v_version);
  end if;

  v_resultado := public.guardar_packing_list(null, p_cabecera, p_items, p_usuario, null);
  v_id := (v_resultado->>'id')::uuid;

  update public.packing_lists
     set client_request_id = p_client_request_id, capturado_en = p_capturado_en
   where id = v_id;
  return v_resultado;
end;
$$;

-- Permisos: solo el backend (service_role) puede llamarlas.
revoke all on function public.crear_toma_fisica_inventario_idem(uuid, timestamptz, uuid, uuid[], text, uuid, uuid[], uuid[])
  from public, anon, authenticated;
grant execute on function public.crear_toma_fisica_inventario_idem(uuid, timestamptz, uuid, uuid[], text, uuid, uuid[], uuid[])
  to service_role;
revoke all on function public.registrar_pesaje_toma_fisica_idem(uuid, timestamptz, uuid, uuid, uuid, numeric, numeric, text[], uuid)
  from public, anon, authenticated;
grant execute on function public.registrar_pesaje_toma_fisica_idem(uuid, timestamptz, uuid, uuid, uuid, numeric, numeric, text[], uuid)
  to service_role;
revoke all on function public.crear_transformacion_ferroso_idem(uuid, timestamptz, uuid, uuid, numeric, numeric, date, text, text[], uuid)
  from public, anon, authenticated;
grant execute on function public.crear_transformacion_ferroso_idem(uuid, timestamptz, uuid, uuid, numeric, numeric, date, text, text[], uuid)
  to service_role;
revoke all on function public.crear_transformacion_pcb_idem(uuid, timestamptz, uuid, numeric, numeric, date, text, text[], uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.crear_transformacion_pcb_idem(uuid, timestamptz, uuid, numeric, numeric, date, text, text[], uuid, uuid)
  to service_role;
revoke all on function public.guardar_packing_list_idem(uuid, timestamptz, jsonb, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.guardar_packing_list_idem(uuid, timestamptz, jsonb, jsonb, uuid)
  to service_role;

-- =============================================================================
-- ROLLBACK (solo si hay que revertir; no borra filas de negocio, solo la marca de idempotencia):
--   drop function if exists public.guardar_packing_list_idem(uuid, timestamptz, jsonb, jsonb, uuid);
--   drop function if exists public.crear_transformacion_pcb_idem(uuid, timestamptz, uuid, numeric, numeric, date, text, text[], uuid, uuid);
--   drop function if exists public.crear_transformacion_ferroso_idem(uuid, timestamptz, uuid, uuid, numeric, numeric, date, text, text[], uuid);
--   drop function if exists public.registrar_pesaje_toma_fisica_idem(uuid, timestamptz, uuid, uuid, uuid, numeric, numeric, text[], uuid);
--   drop function if exists public.crear_toma_fisica_inventario_idem(uuid, timestamptz, uuid, uuid[], text, uuid, uuid[], uuid[]);
--   drop index if exists public.uq_packing_lists_client_request_id;
--   drop index if exists public.uq_transformaciones_client_request_id;
--   drop index if exists public.uq_vehiculos_client_request_id;
--   drop index if exists public.uq_almacenes_client_request_id;
--   drop index if exists public.uq_taras_client_request_id;
--   drop index if exists public.uq_productos_client_request_id;
--   drop index if exists public.uq_clientes_client_request_id;
--   drop index if exists public.uq_proveedores_client_request_id;
--   drop index if exists public.uq_detalle_toma_fisica_client_request_id;
--   drop index if exists public.uq_tomas_fisicas_client_request_id;
--   alter table public.packing_lists            drop column if exists capturado_en, drop column if exists client_request_id;
--   alter table public.transformaciones         drop column if exists capturado_en, drop column if exists client_request_id;
--   alter table public.vehiculos                drop column if exists capturado_en, drop column if exists client_request_id;
--   alter table public.almacenes                drop column if exists capturado_en, drop column if exists client_request_id;
--   alter table public.taras                    drop column if exists capturado_en, drop column if exists client_request_id;
--   alter table public.productos                drop column if exists capturado_en, drop column if exists client_request_id;
--   alter table public.clientes                 drop column if exists capturado_en, drop column if exists client_request_id;
--   alter table public.proveedores              drop column if exists capturado_en, drop column if exists client_request_id;
--   alter table public.detalle_toma_fisica      drop column if exists capturado_en, drop column if exists client_request_id;
--   alter table public.tomas_fisicas_inventario drop column if exists capturado_en, drop column if exists client_request_id;
-- (NO tocar operaciones_cliente ni reclamar_operacion_cliente: son de la Fase 3.)
-- =============================================================================
