-- Extraído de producción vía pg_get_functiondef, 11-sep-2026
-- Args: p_toma_fisica_id uuid, p_cancelada_por uuid

CREATE OR REPLACE FUNCTION public.cancelar_toma_fisica_inventario(p_toma_fisica_id uuid, p_cancelada_por uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_estado text;
begin
  select estado into v_estado
    from public.tomas_fisicas_inventario where id = p_toma_fisica_id;

  if v_estado is null then
    raise exception 'Toma física no encontrada.';
  end if;
  if v_estado <> 'abierta' then
    raise exception 'Solo se puede cancelar una toma física abierta.';
  end if;

  update public.tomas_fisicas_inventario
     set estado = 'cancelada',
         cerrada_por = p_cancelada_por,
         cerrada_en = now()
   where id = p_toma_fisica_id;
end;
$function$
;
