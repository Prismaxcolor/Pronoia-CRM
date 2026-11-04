-- =============================================================================
-- Modo sin conexión: limpieza de public.operaciones_cliente
-- =============================================================================
-- Problema: operaciones_cliente guarda una fila por cada clientRequestId y nunca se borra, así que
-- crece sin límite (y cualquier usuario autenticado puede generarlas con UUID aleatorios).
--
-- Solución: la función public.limpiar_operaciones_cliente() borra en LOTES las filas con más de
-- p_dias (por defecto 30) cuyo estado es 'ok' o 'error'. Nunca toca 'procesando' (una operación en
-- curso o recién abandonada debe poder retomarse). Es segura frente a ejecuciones simultáneas: si otra
-- limpieza está corriendo (advisory lock) devuelve 0 sin esperar, y las filas se toman con
-- `for update skip locked`, de modo que no bloquea a reclamar_operacion_cliente.
--
-- Quién la ejecuta: el backend la llama de forma oportunista (≈1 % de las operaciones nuevas, en segundo
-- plano; backend/src/services/operaciones-limpieza.ts). También puede lanzarse a mano desde el SQL Editor:
--   select public.limpiar_operaciones_cliente();          -- 30 días, lote de 1000
--   select public.limpiar_operaciones_cliente(60, 5000);  -- 60 días, lote de 5000
-- Cada llamada borra como máximo p_lote filas; el 1 % oportunista converge sin picos.
--
-- Efecto a tener en cuenta: pasados 30 días de una operación 'ok', reenviar ese mismo clientRequestId
-- volvería a ejecutarla. La cola del teléfono debe descartar operaciones pendientes de más de 30 días.
--
-- CÓMO APLICAR: Supabase Studio -> SQL Editor. Seguro de repetir (create or replace). Aditivo.
-- ROLLBACK al final (comentado).
-- =============================================================================

create or replace function public.limpiar_operaciones_cliente(
  p_dias integer default 30,
  p_lote integer default 1000
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dias     integer := greatest(coalesce(p_dias, 30), 7);          -- nunca menos de 7 días
  v_lote     integer := least(greatest(coalesce(p_lote, 1000), 1), 5000);
  v_borradas integer;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('limpiar_operaciones_cliente', 0)) then
    return 0;
  end if;

  with candidatas as (
    select client_request_id
      from public.operaciones_cliente
     where estado in ('ok', 'error')
       and recibido_en < now() - make_interval(days => v_dias)
     order by recibido_en
     limit v_lote
       for update skip locked
  )
  delete from public.operaciones_cliente o
   using candidatas c
   where o.client_request_id = c.client_request_id;

  get diagnostics v_borradas = row_count;
  return v_borradas;
end;
$$;

revoke all on function public.limpiar_operaciones_cliente(integer, integer) from public, anon, authenticated;
grant execute on function public.limpiar_operaciones_cliente(integer, integer) to service_role;

-- =============================================================================
-- ROLLBACK:
--   drop function if exists public.limpiar_operaciones_cliente(integer, integer);
-- =============================================================================
