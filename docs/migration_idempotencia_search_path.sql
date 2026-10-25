-- =============================================================================
-- Modo sin conexión: search_path fijo en las funciones de idempotencia
-- =============================================================================
-- Verificado en producción (pg_proc, solo lectura): reclamar_operacion_cliente es SECURITY DEFINER con
-- search_path = public (sin pg_temp al final, así que pg_temp se busca PRIMERO y un usuario podría
-- sombrear objetos temporales). Las funciones *_idem son SECURITY INVOKER y 7 de las 8 no tienen
-- search_path fijado; guardar_packing_list_idem ya tiene `public`.
--
-- Esta migración fija `search_path = public, pg_temp` en todas con ALTER FUNCTION: no cambia la lógica,
-- los permisos ni la firma. El orden `public, pg_temp` pone pg_temp al final (recomendación de Supabase/
-- Postgres para SECURITY DEFINER).
--
-- CÓMO APLICAR: Supabase Studio -> SQL Editor. Seguro de repetir. ROLLBACK al final (comentado).
-- Fuera de alcance (revisar aparte): create_user y verify_login son SECURITY DEFINER sin search_path;
-- usan pgcrypto, por eso no se tocan aquí sin probar dónde vive la extensión.
-- =============================================================================

alter function public.reclamar_operacion_cliente(uuid, text, uuid, timestamptz, integer)
  set search_path = public, pg_temp;

alter function public.crear_ticket_pesaje_idem(uuid, timestamptz, text, uuid, date, text[], text, jsonb, text, uuid, numeric, numeric, boolean, text[], jsonb, uuid, text)
  set search_path = public, pg_temp;
alter function public.crear_traslado_idem(uuid, timestamptz, uuid, uuid, text, jsonb, uuid, jsonb, text)
  set search_path = public, pg_temp;
alter function public.crear_toma_fisica_inventario_idem(uuid, timestamptz, uuid, uuid[], text, uuid, uuid[], uuid[])
  set search_path = public, pg_temp;
alter function public.registrar_pesaje_toma_fisica_idem(uuid, timestamptz, uuid, uuid, uuid, numeric, numeric, text[], uuid)
  set search_path = public, pg_temp;
alter function public.crear_transformacion_ferroso_idem(uuid, timestamptz, uuid, uuid, numeric, numeric, date, text, text[], uuid)
  set search_path = public, pg_temp;
alter function public.crear_transformacion_pcb_idem(uuid, timestamptz, uuid, numeric, numeric, date, text, text[], uuid, uuid)
  set search_path = public, pg_temp;
alter function public.guardar_packing_list_idem(uuid, timestamptz, jsonb, jsonb, uuid)
  set search_path = public, pg_temp;

-- =============================================================================
-- ROLLBACK (estado anterior verificado en producción):
--   alter function public.reclamar_operacion_cliente(uuid, text, uuid, timestamptz, integer) set search_path = public;
--   alter function public.guardar_packing_list_idem(uuid, timestamptz, jsonb, jsonb, uuid) set search_path = public;
--   alter function public.crear_ticket_pesaje_idem(uuid, timestamptz, text, uuid, date, text[], text, jsonb, text, uuid, numeric, numeric, boolean, text[], jsonb, uuid, text) reset search_path;
--   alter function public.crear_traslado_idem(uuid, timestamptz, uuid, uuid, text, jsonb, uuid, jsonb, text) reset search_path;
--   alter function public.crear_toma_fisica_inventario_idem(uuid, timestamptz, uuid, uuid[], text, uuid, uuid[], uuid[]) reset search_path;
--   alter function public.registrar_pesaje_toma_fisica_idem(uuid, timestamptz, uuid, uuid, uuid, numeric, numeric, text[], uuid) reset search_path;
--   alter function public.crear_transformacion_ferroso_idem(uuid, timestamptz, uuid, uuid, numeric, numeric, date, text, text[], uuid) reset search_path;
--   alter function public.crear_transformacion_pcb_idem(uuid, timestamptz, uuid, numeric, numeric, date, text, text[], uuid, uuid) reset search_path;
-- =============================================================================
