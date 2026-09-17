-- Extraído de producción vía pg_get_functiondef, 11-sep-2026
-- Args: p_almacen_id uuid, p_producto_id uuid, p_lote_id uuid

CREATE OR REPLACE FUNCTION public.hay_toma_fisica_abierta(p_almacen_id uuid, p_producto_id uuid, p_lote_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists(
    select 1
    from public.tomas_fisicas_inventario t
    join public.productos p on p.id = p_producto_id
    where t.almacen_id = p_almacen_id
      and t.estado = 'abierta'
      and p.tipo_material_id = any(t.categorias)
      and (
        t.lote_ids is null or array_length(t.lote_ids, 1) is null
        or p_lote_id is null
        or p_lote_id = any(t.lote_ids)
      )
  );
$function$
;
