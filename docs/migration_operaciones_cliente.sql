-- =============================================================================
-- Modo sin conexión (Fase 3): idempotencia de operaciones enviadas por el cliente
-- =============================================================================
-- Problema: si un envío se corta DESPUÉS de llegar al servidor, el cliente
-- reintenta y el pesaje/traslado se duplica. Solución: cada operación lleva un
-- `client_request_id` (UUID generado en el teléfono antes del primer intento)
-- y el servidor la registra en `operaciones_cliente`. Un reintento con el mismo
-- id devuelve el resultado guardado en vez de crear otro registro.
--
-- Contenido (todo aditivo, nada existente se modifica):
--   1. public.operaciones_cliente (RLS deny-all: solo service_role).
--   2. public.reclamar_operacion_cliente(): reclamo atómico a prueba de carreras.
--   2b. crear_ticket_pesaje_idem() y crear_traslado_idem(): envoltorios que garantizan una sola fila.
--   3. tickets_pesaje y tickets_traslado: columnas client_request_id (único
--      cuando existe) y capturado_en (cuándo se hizo la operación en el teléfono).
--
-- CÓMO APLICAR: pegar en Supabase Studio → SQL Editor y ejecutar. Es seguro
-- ejecutarlo más de una vez (if not exists / create or replace).
-- El backend tolera que esta migración aún no esté aplicada: sin la función
-- reclamar_operacion_cliente() ejecuta la operación como siempre (sin idempotencia).
--
-- ROLLBACK (al final del archivo, comentado).
-- =============================================================================

-- 1. Tabla de operaciones del cliente ------------------------------------------
create table if not exists public.operaciones_cliente (
  client_request_id uuid primary key,
  tipo              text not null,
  usuario_id        uuid not null,
  recibido_en       timestamptz not null default now(),
  capturado_en      timestamptz,
  estado            text not null default 'procesando'
                    check (estado in ('procesando', 'ok', 'error')),
  resultado         jsonb,
  entidad_id        uuid,
  error             text
);

create index if not exists idx_operaciones_cliente_usuario
  on public.operaciones_cliente (usuario_id, recibido_en desc);
create index if not exists idx_operaciones_cliente_estado
  on public.operaciones_cliente (estado, recibido_en);

-- RLS deny-all: sin políticas, solo service_role (que la omite) puede leer/escribir.
alter table public.operaciones_cliente enable row level security;
revoke all on public.operaciones_cliente from anon, authenticated;

-- 2. Reclamo atómico -------------------------------------------------------------
-- Devuelve jsonb:
--   {accion:'ejecutar'}                          → este llamador debe ejecutar la operación.
--   {accion:'ejecutar', retomada:true}           → intento anterior murió (procesando vencido) o fue 'error'.
--   {accion:'repetida', resultado, entidad_id}   → ya se hizo: devolver el resultado guardado.
--   {accion:'en_proceso'}                        → otro intento sigue en curso: el cliente reintenta luego.
--   {accion:'conflicto'}                         → el id pertenece a otro usuario u otro tipo de operación.
create or replace function public.reclamar_operacion_cliente(
  p_client_request_id uuid,
  p_tipo              text,
  p_usuario_id        uuid,
  p_capturado_en      timestamptz default null,
  p_vencimiento_seg   integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_insertadas integer;
  v_fila       public.operaciones_cliente%rowtype;
begin
  insert into public.operaciones_cliente (client_request_id, tipo, usuario_id, capturado_en)
  values (p_client_request_id, p_tipo, p_usuario_id, p_capturado_en)
  on conflict (client_request_id) do nothing;
  get diagnostics v_insertadas = row_count;

  if v_insertadas = 1 then
    return jsonb_build_object('accion', 'ejecutar');
  end if;

  -- La fila ya existía: se bloquea para que dos reintentos simultáneos se serialicen.
  select * into v_fila
  from public.operaciones_cliente
  where client_request_id = p_client_request_id
  for update;

  if v_fila.usuario_id <> p_usuario_id or v_fila.tipo <> p_tipo then
    return jsonb_build_object('accion', 'conflicto');
  end if;

  if v_fila.estado = 'ok' then
    return jsonb_build_object('accion', 'repetida', 'resultado', v_fila.resultado, 'entidad_id', v_fila.entidad_id);
  end if;

  if v_fila.estado = 'error'
     or v_fila.recibido_en < now() - make_interval(secs => p_vencimiento_seg) then
    update public.operaciones_cliente
       set estado = 'procesando', recibido_en = now(), error = null,
           capturado_en = coalesce(p_capturado_en, capturado_en)
     where client_request_id = p_client_request_id;
    return jsonb_build_object('accion', 'ejecutar', 'retomada', true);
  end if;

  return jsonb_build_object('accion', 'en_proceso');
end;
$$;

revoke all on function public.reclamar_operacion_cliente(uuid, text, uuid, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.reclamar_operacion_cliente(uuid, text, uuid, timestamptz, integer)
  to service_role;

-- 3. Columnas en pesajes y traslados ------------------------------------------------
alter table public.tickets_pesaje   add column if not exists client_request_id uuid;
alter table public.tickets_pesaje   add column if not exists capturado_en timestamptz;
alter table public.tickets_traslado add column if not exists client_request_id uuid;
alter table public.tickets_traslado add column if not exists capturado_en timestamptz;

create unique index if not exists uq_tickets_pesaje_client_request_id
  on public.tickets_pesaje (client_request_id) where client_request_id is not null;
create unique index if not exists uq_tickets_traslado_client_request_id
  on public.tickets_traslado (client_request_id) where client_request_id is not null;

-- 4. Envoltorios que garantizan UNA sola fila por client_request_id -------------------
-- Dentro de UNA transacción: (1) candado por client_request_id, (2) si ya existe una fila con ese id
-- se devuelve su id sin crear nada, (3) si no, se llama al RPC original (sin tocarlo) y (4) se fija
-- client_request_id y capturado_en en la fila creada. Si el servidor cae en cualquier punto, la
-- transacción se revierte entera (no queda fila a medias) o ya quedó completa con su marca; el índice
-- único es la red de seguridad final. Los RPC de completar no necesitan envoltorio: ya fallan con
-- "ya está completo" si se repiten, así que no pueden duplicar nada.
create or replace function public.crear_ticket_pesaje_idem(
  p_client_request_id uuid, p_capturado_en timestamptz,
  p_tipo text, p_entidad_id uuid, p_fecha date, p_fotos text[], p_observaciones text,
  p_materiales jsonb, p_estado text, p_pesado_por uuid, p_peso_global numeric,
  p_devolucion numeric, p_pesaje_exterior boolean, p_fotos_devolucion text[],
  p_pesajes_globales jsonb, p_almacen_id uuid, p_vehiculo text
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('crear_ticket_pesaje:' || p_client_request_id::text, 0));

  select id into v_id from public.tickets_pesaje where client_request_id = p_client_request_id;
  if v_id is not null then
    return v_id;
  end if;

  v_id := public.crear_ticket_pesaje(
    p_tipo, p_entidad_id, p_fecha, p_fotos, p_observaciones, p_materiales, p_estado, p_pesado_por,
    p_peso_global, p_devolucion, p_pesaje_exterior, p_fotos_devolucion, p_pesajes_globales,
    p_almacen_id, p_vehiculo
  );

  update public.tickets_pesaje
     set client_request_id = p_client_request_id, capturado_en = p_capturado_en
   where id = v_id;
  return v_id;
end;
$$;

create or replace function public.crear_traslado_idem(
  p_client_request_id uuid, p_capturado_en timestamptz,
  p_almacen_origen_id uuid, p_almacen_destino_id uuid, p_observaciones text, p_materiales jsonb,
  p_pesado_por uuid, p_lotes jsonb, p_vehiculo text
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('crear_traslado:' || p_client_request_id::text, 0));

  select id into v_id from public.tickets_traslado where client_request_id = p_client_request_id;
  if v_id is not null then
    return v_id;
  end if;

  v_id := public.crear_traslado(
    p_almacen_origen_id, p_almacen_destino_id, p_observaciones, p_materiales, p_pesado_por,
    p_lotes, p_vehiculo
  );

  update public.tickets_traslado
     set client_request_id = p_client_request_id, capturado_en = p_capturado_en
   where id = v_id;
  return v_id;
end;
$$;

revoke all on function public.crear_ticket_pesaje_idem(uuid, timestamptz, text, uuid, date, text[], text, jsonb, text, uuid, numeric, numeric, boolean, text[], jsonb, uuid, text)
  from public, anon, authenticated;
grant execute on function public.crear_ticket_pesaje_idem(uuid, timestamptz, text, uuid, date, text[], text, jsonb, text, uuid, numeric, numeric, boolean, text[], jsonb, uuid, text)
  to service_role;
revoke all on function public.crear_traslado_idem(uuid, timestamptz, uuid, uuid, text, jsonb, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.crear_traslado_idem(uuid, timestamptz, uuid, uuid, text, jsonb, uuid, jsonb, text)
  to service_role;

-- =============================================================================
-- ROLLBACK (ejecutar solo si hay que revertir; no toca datos de pesajes):
--   drop function if exists public.crear_traslado_idem(uuid, timestamptz, uuid, uuid, text, jsonb, uuid, jsonb, text);
--   drop function if exists public.crear_ticket_pesaje_idem(uuid, timestamptz, text, uuid, date, text[], text, jsonb, text, uuid, numeric, numeric, boolean, text[], jsonb, uuid, text);
--   drop index if exists public.uq_tickets_traslado_client_request_id;
--   drop index if exists public.uq_tickets_pesaje_client_request_id;
--   alter table public.tickets_traslado drop column if exists capturado_en;
--   alter table public.tickets_traslado drop column if exists client_request_id;
--   alter table public.tickets_pesaje   drop column if exists capturado_en;
--   alter table public.tickets_pesaje   drop column if exists client_request_id;
--   drop function if exists public.reclamar_operacion_cliente(uuid, text, uuid, timestamptz, integer);
--   drop table if exists public.operaciones_cliente;
-- =============================================================================
