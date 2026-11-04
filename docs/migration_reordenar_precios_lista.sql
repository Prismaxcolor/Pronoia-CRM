-- =============================================================================
-- Listas de precios: reordenar materiales en UNA operación atómica y validada
-- =============================================================================
-- Idempotente, una transacción. NO aplicada todavía.
-- Antes el backend lanzaba N updates en paralelo (si uno fallaba, el orden quedaba a medias) y no
-- comprobaba que el orden recibido cubriera los materiales de la lista.
--
-- reordenar_precios_lista(p_lista_id, p_producto_ids):
--   - bloquea las filas de precios de la lista (for update) y exige que p_producto_ids contenga
--     EXACTAMENTE esos materiales: sin faltantes, sin ajenos, sin duplicados, no vacío.
--   - asigna orden 0..n-1 en un solo UPDATE. Si algo no cuadra lanza P0001 (mensaje en español) y
--     no cambia nada.
-- Incluye (idempotente) la columna `orden` de migration_precios_lista_orden.sql.
--
-- ROLLBACK al final (comentado).
-- =============================================================================

begin;

alter table public.precios_lista
  add column if not exists orden integer not null default 0;

create or replace function public.reordenar_precios_lista(
  p_lista_id      uuid,
  p_producto_ids  uuid[]
) returns integer
language plpgsql
set search_path = public
as $function$
declare
  v_actuales uuid[];
  v_total    integer;
begin
  if p_lista_id is null or p_producto_ids is null or coalesce(array_length(p_producto_ids, 1), 0) = 0 then
    raise exception 'El orden de la lista no puede estar vacío.';
  end if;
  if (select count(distinct x) from unnest(p_producto_ids) as x) <> array_length(p_producto_ids, 1) then
    raise exception 'El orden tiene materiales repetidos.';
  end if;

  -- Bloquea las filas de la lista mientras se compara y se reescribe el orden.
  select coalesce(array_agg(producto_id), '{}')
    into v_actuales
    from (
      select producto_id from public.precios_lista where lista_id = p_lista_id order by id for update
    ) t;

  if coalesce(array_length(v_actuales, 1), 0) = 0 then
    raise exception 'Lista de precios no encontrada o sin materiales.';
  end if;
  if exists (select 1 from unnest(p_producto_ids) as x where x <> all (v_actuales)) then
    raise exception 'El orden incluye materiales que no pertenecen a esta lista.';
  end if;
  if array_length(v_actuales, 1) <> array_length(p_producto_ids, 1) then
    raise exception 'El orden no incluye todos los materiales de la lista; recarga e intenta de nuevo.';
  end if;

  update public.precios_lista p
     set orden = e.ord::integer - 1
    from unnest(p_producto_ids) with ordinality as e(producto_id, ord)
   where p.lista_id = p_lista_id and p.producto_id = e.producto_id;
  get diagnostics v_total = row_count;
  return v_total;
end;
$function$;

revoke execute on function public.reordenar_precios_lista(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reordenar_precios_lista(uuid, uuid[]) to service_role;

commit;

-- ROLLBACK:
--   drop function if exists public.reordenar_precios_lista(uuid, uuid[]);
--   (la columna `orden` se conserva; su rollback propio es `alter table public.precios_lista drop column orden;`)
