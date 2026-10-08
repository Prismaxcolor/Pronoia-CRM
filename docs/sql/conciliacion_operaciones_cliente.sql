-- =============================================================================
-- Conciliacion de operaciones del modo sin conexion (SOLO LECTURA)
-- =============================================================================
-- Tablas: public.operaciones_cliente (docs/migration_operaciones_cliente.sql),
--         public.tickets_pesaje y public.tickets_traslado (columnas
--         client_request_id y capturado_en).
--
-- Este archivo solo contiene SELECT. No modifica nada. Ejecutar en Supabase
-- Studio > SQL Editor, una consulta a la vez (seleccionar y "Run selected").
-- Ajustar el bloque "parametros" de cada consulta (ventana de dias, usuario).
-- Ver docs/OFFLINE_RUNBOOK.md para como interpretar cada resultado.
--
-- Nota: los tickets no tienen columna "codigo"; el codigo visible (Pesaje-0001,
-- Traslado-0001) se deriva de la columna "numero".
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Salvaguarda: la migracion esta aplicada?  Debe devolver existe = true en las 4.
-- -----------------------------------------------------------------------------
select 'tabla operaciones_cliente' as objeto, to_regclass('public.operaciones_cliente') is not null as existe
union all
select 'funcion reclamar_operacion_cliente',
       exists (select 1 from pg_proc where proname = 'reclamar_operacion_cliente')
union all
select 'columna tickets_pesaje.client_request_id',
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'tickets_pesaje' and column_name = 'client_request_id')
union all
select 'columna tickets_traslado.client_request_id',
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'tickets_traslado' and column_name = 'client_request_id');


-- -----------------------------------------------------------------------------
-- 1. OPERACIONES RECIBIDAS: resumen por dia, tipo y estado.
--    Parametro: ventana (dias).
-- -----------------------------------------------------------------------------
with parametros as (select 14::int as dias)
select date_trunc('day', o.recibido_en)::date as dia,
       o.tipo,
       o.estado,
       count(*)                                as operaciones,
       min(o.recibido_en)                      as primera,
       max(o.recibido_en)                      as ultima,
       -- Retraso entre que se hizo en el telefono y que llego al servidor.
       round(avg(extract(epoch from (o.recibido_en - o.capturado_en)) / 60)::numeric, 1) as retraso_medio_min,
       round(max(extract(epoch from (o.recibido_en - o.capturado_en)) / 60)::numeric, 1) as retraso_max_min
  from public.operaciones_cliente o, parametros p
 where o.recibido_en >= now() - make_interval(days => p.dias)
 group by 1, 2, 3
 order by 1 desc, 2, 3;


-- -----------------------------------------------------------------------------
-- 1b. OPERACIONES RECIBIDAS: detalle (para "se me perdio un pesaje").
--     Parametros: usuario (uuid) y ventana. Dejar usuario en null para todos.
-- -----------------------------------------------------------------------------
with parametros as (select null::uuid as usuario, 3::int as dias)
select o.client_request_id,
       o.tipo,
       o.estado,
       o.usuario_id,
       u.email                 as usuario_email,
       o.capturado_en,
       o.recibido_en,
       o.entidad_id,
       o.error
  from public.operaciones_cliente o
  left join auth.users u on u.id = o.usuario_id
  cross join parametros p
 where o.recibido_en >= now() - make_interval(days => p.dias)
   and (p.usuario is null or o.usuario_id = p.usuario)
 order by o.recibido_en desc
 limit 500;


-- -----------------------------------------------------------------------------
-- 2. DUPLICADOS POR CLAVE
--    2a. Mas de un ticket de pesaje / traslado con el mismo client_request_id.
--        Debe devolver 0 filas (hay indice unico parcial; si aparece algo, el
--        indice no esta creado o se desactivo).
-- -----------------------------------------------------------------------------
select 'tickets_pesaje' as tabla, client_request_id, count(*) as registros,
       array_agg(id order by created_at) as ids
  from public.tickets_pesaje
 where client_request_id is not null
 group by client_request_id
having count(*) > 1
union all
select 'tickets_traslado', client_request_id, count(*), array_agg(id order by created_at)
  from public.tickets_traslado
 where client_request_id is not null
 group by client_request_id
having count(*) > 1;

--    2b. Duplicados "de negocio" sospechosos: mismo proveedor/cliente, mismo
--        peso global y misma fecha, creados con menos de 10 minutos de
--        diferencia y SIN el mismo client_request_id (p. ej. el usuario volvio
--        a capturar a mano un pesaje que ya estaba en la cola). Revisar a mano:
--        pueden ser legitimos (dos camiones iguales).
select a.id as ticket_a, b.id as ticket_b,
       a.numero as numero_a, b.numero as numero_b,
       a.entidad_id, a.peso_global, a.fecha,
       a.created_at as creado_a, b.created_at as creado_b,
       a.client_request_id as crid_a, b.client_request_id as crid_b
  from public.tickets_pesaje a
  join public.tickets_pesaje b
    on a.entidad_id = b.entidad_id
   and a.peso_global = b.peso_global
   and a.fecha = b.fecha
   and a.id < b.id
   and abs(extract(epoch from (a.created_at - b.created_at))) < 600
 where a.created_at >= now() - interval '14 days'
   and a.peso_global is not null and a.peso_global > 0
   and (a.client_request_id is distinct from b.client_request_id)
 order by a.created_at desc;


-- -----------------------------------------------------------------------------
-- 3. OPERACIONES EN ERROR (o atascadas en 'procesando')
--    'error'      : el servidor rechazo la operacion (ver columna error). El
--                   telefono la deja en "rechazadas" con sus datos.
--    'procesando' : mas de 5 minutos sin terminar = intento que murio a mitad;
--                   el reintento del telefono la retomara (vencimiento 120 s).
-- -----------------------------------------------------------------------------
select o.client_request_id, o.tipo, o.estado, o.usuario_id, u.email as usuario_email,
       o.capturado_en, o.recibido_en,
       round(extract(epoch from (now() - o.recibido_en)) / 60) as minutos_desde_recibida,
       o.error
  from public.operaciones_cliente o
  left join auth.users u on u.id = o.usuario_id
 where (o.estado = 'error' and o.recibido_en >= now() - interval '30 days')
    or (o.estado = 'procesando' and o.recibido_en < now() - interval '5 minutes')
 order by o.recibido_en desc;

-- Resumen de motivos de error (para detectar un problema sistematico).
select left(o.error, 120) as motivo, o.tipo, count(*) as veces, max(o.recibido_en) as ultima
  from public.operaciones_cliente o
 where o.estado = 'error' and o.recibido_en >= now() - interval '30 days'
 group by 1, 2
 order by veces desc;


-- -----------------------------------------------------------------------------
-- 4. HUERFANAS
--    4a. Operacion 'ok' cuya entidad creada ya no existe (se borro el ticket o
--        el traslado despues), o sin entidad_id.
--        Interpretacion: normal si alguien elimino el ticket a proposito
--        (revisar auditoria); anomalia si nadie lo hizo.
--        El texto de 'tipo' lo define el backend; se filtra por palabra clave.
-- -----------------------------------------------------------------------------
select o.client_request_id, o.tipo, o.recibido_en, o.capturado_en, o.entidad_id, o.usuario_id
  from public.operaciones_cliente o
 where o.estado = 'ok'
   and o.recibido_en >= now() - interval '30 days'
   and (
        o.entidad_id is null
     or (o.tipo ilike '%pesaje%' and not exists (select 1 from public.tickets_pesaje t where t.id = o.entidad_id))
     or (o.tipo ilike '%traslado%' and not exists (select 1 from public.tickets_traslado t where t.id = o.entidad_id))
   )
 order by o.recibido_en desc;

--    4b. Tickets con client_request_id SIN operacion registrada: el registro se
--        creo pero no hay constancia en operaciones_cliente (p. ej. la
--        migracion se aplico despues, o fallo el 'finalizar').
select 'tickets_pesaje' as tabla, t.id, t.numero, t.client_request_id, t.created_at, t.capturado_en
  from public.tickets_pesaje t
 where t.client_request_id is not null
   and not exists (select 1 from public.operaciones_cliente o where o.client_request_id = t.client_request_id)
union all
select 'tickets_traslado', t.id, t.numero, t.client_request_id, t.created_at, t.capturado_en
  from public.tickets_traslado t
 where t.client_request_id is not null
   and not exists (select 1 from public.operaciones_cliente o where o.client_request_id = t.client_request_id)
 order by 5 desc;

--    4c. Operaciones 'procesando'/'error' cuyo ticket SI existe: el registro se
--        creo pero la operacion no quedo en 'ok' (el reintento la cerrara; si
--        el telefono ya no reintenta, se puede cerrar a mano tras revisar).
select o.client_request_id, o.tipo, o.estado, o.recibido_en, 'pesaje' as origen, t.id as ticket_id, t.numero
  from public.operaciones_cliente o
  join public.tickets_pesaje t on t.client_request_id = o.client_request_id
 where o.estado <> 'ok'
union all
select o.client_request_id, o.tipo, o.estado, o.recibido_en, 'traslado', t.id, t.numero
  from public.operaciones_cliente o
  join public.tickets_traslado t on t.client_request_id = o.client_request_id
 where o.estado <> 'ok'
 order by 4 desc;


-- -----------------------------------------------------------------------------
-- 5. BUSCAR UNA OPERACION CONCRETA por client_request_id (el que muestra la
--    pantalla de la cola / el respaldo exportado). Reemplazar el uuid.
-- -----------------------------------------------------------------------------
with parametros as (select '00000000-0000-0000-0000-000000000000'::uuid as crid)
select 'operacion' as fuente, o.client_request_id::text as clave, o.estado as detalle, o.recibido_en as cuando, o.error as extra
  from public.operaciones_cliente o, parametros p where o.client_request_id = p.crid
union all
select 'ticket_pesaje', t.id::text, t.numero::text, t.created_at, null
  from public.tickets_pesaje t, parametros p where t.client_request_id = p.crid
union all
select 'ticket_traslado', t.id::text, t.numero::text, t.created_at, null
  from public.tickets_traslado t, parametros p where t.client_request_id = p.crid;
