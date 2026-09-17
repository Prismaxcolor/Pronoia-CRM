-- Extraído de producción vía pg_get_functiondef, 11-sep-2026
-- Args: p_toma_fisica_id uuid, p_producto_id uuid, p_lote_id uuid, p_peso_bruto numeric, p_tara numeric, p_fotos text[], p_registrado_por uuid

CREATE OR REPLACE FUNCTION public.registrar_pesaje_toma_fisica(p_toma_fisica_id uuid, p_producto_id uuid, p_lote_id uuid, p_peso_bruto numeric, p_tara numeric, p_fotos text[], p_registrado_por uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_estado   text;
  v_lote_ids uuid[];
  v_id       uuid;
begin
  select estado, lote_ids into v_estado, v_lote_ids from public.tomas_fisicas_inventario where id = p_toma_fisica_id;
  if v_estado is null then
    raise exception 'Toma física no encontrada.';
  end if;
  if v_estado <> 'abierta' then
    raise exception 'Esta toma física ya está cerrada.';
  end if;
  if coalesce(p_peso_bruto, 0) - coalesce(p_tara, 0) < 0 then
    raise exception 'El peso neto no puede ser negativo.';
  end if;
  if p_fotos is null or array_length(p_fotos, 1) is null then
    raise exception 'Cada pesaje de conteo requiere al menos una foto.';
  end if;
  if p_producto_id is null and p_lote_id is null then
    raise exception 'Elige un material o un lote.';
  end if;
  if v_lote_ids is not null and array_length(v_lote_ids, 1) is not null
     and p_lote_id is not null and not (p_lote_id = any(v_lote_ids)) then
    raise exception 'Ese lote no forma parte de esta toma física.';
  end if;

  insert into public.detalle_toma_fisica (toma_fisica_id, producto_id, lote_id, peso_bruto, tara, fotos, registrado_por)
  values (p_toma_fisica_id, p_producto_id, p_lote_id, p_peso_bruto, coalesce(p_tara, 0), p_fotos, p_registrado_por)
  returning id into v_id;

  return v_id;
end;
$function$
;
