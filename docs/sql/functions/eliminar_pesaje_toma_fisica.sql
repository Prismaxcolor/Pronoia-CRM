-- Extraído de producción vía pg_get_functiondef, 11-sep-2026
-- Args: p_detalle_id uuid

CREATE OR REPLACE FUNCTION public.eliminar_pesaje_toma_fisica(p_detalle_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_estado text;
begin
  select t.estado into v_estado
    from public.detalle_toma_fisica d
    join public.tomas_fisicas_inventario t on t.id = d.toma_fisica_id
   where d.id = p_detalle_id;

  if v_estado is null then
    raise exception 'Pesaje no encontrado.';
  end if;
  if v_estado <> 'abierta' then
    raise exception 'Esta toma física ya está cerrada.';
  end if;

  delete from public.detalle_toma_fisica where id = p_detalle_id;
end;
$function$
;
