-- Extraído de producción vía pg_get_functiondef, 11-sep-2026
-- Args: p_almacen_id uuid

CREATE OR REPLACE FUNCTION public.marcar_almacen_predeterminado(p_almacen_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$ declare v_activo boolean; begin select activo into v_activo from public.almacenes where id = p_almacen_id; if v_activo is null then raise exception 'Almacén no encontrado.'; end if; if not v_activo then raise exception 'Un almacén inactivo no puede ser el predeterminado.'; end if; update public.almacenes set es_predeterminado = false where es_predeterminado and id <> p_almacen_id; update public.almacenes set es_predeterminado = true where id = p_almacen_id; return p_almacen_id; end; $function$
;
