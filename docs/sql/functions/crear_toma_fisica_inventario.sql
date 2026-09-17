-- Extraído de producción vía pg_get_functiondef, 11-sep-2026
-- Args: p_almacen_id uuid, p_categorias uuid[], p_descripcion text, p_abierta_por uuid, p_lote_ids uuid[]

CREATE OR REPLACE FUNCTION public.crear_toma_fisica_inventario(p_almacen_id uuid, p_categorias uuid[], p_descripcion text, p_abierta_por uuid, p_lote_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_id uuid;
begin
  if p_categorias is null or array_length(p_categorias, 1) is null then
    raise exception 'Elige al menos una categoría a inventariar.';
  end if;

  if exists (
    select 1 from public.tomas_fisicas_inventario
    where almacen_id = p_almacen_id and estado = 'abierta' and categorias && p_categorias
  ) then
    raise exception 'Ya hay una toma física abierta para alguna de estas categorías en este almacén.';
  end if;

  insert into public.tomas_fisicas_inventario (almacen_id, categorias, descripcion, abierta_por, lote_ids)
  values (p_almacen_id, p_categorias, nullif(p_descripcion, ''), p_abierta_por, nullif(p_lote_ids, '{}'))
  returning id into v_id;

  return v_id;
end;
$function$
;
