-- Extraído de producción vía pg_get_functiondef, 11-sep-2026
-- Args: p_producto_entrada_id uuid, p_almacen_id uuid, p_peso_bruto numeric, p_tara numeric, p_fecha date, p_notas text, p_fotos_entrada text[], p_registrado_por uuid

CREATE OR REPLACE FUNCTION public.crear_transformacion_ferroso(p_producto_entrada_id uuid, p_almacen_id uuid, p_peso_bruto numeric, p_tara numeric, p_fecha date, p_notas text, p_fotos_entrada text[], p_registrado_por uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_peso_neto numeric;
  v_id uuid;
begin
  v_peso_neto := p_peso_bruto - p_tara;
  if v_peso_neto <= 0 then
    raise exception 'El peso neto de entrada debe ser mayor a 0.';
  end if;
  if p_fotos_entrada is null or array_length(p_fotos_entrada, 1) is null then
    raise exception 'Agrega al menos una foto de entrada.';
  end if;

  insert into transformaciones (
    categoria, producto_entrada_id, almacen_id, lote_origen_id, peso_bruto, tara, fecha, estado, notas, fotos_entrada, registrado_por
  ) values (
    'ferroso_no_ferroso', p_producto_entrada_id, p_almacen_id, null, p_peso_bruto, p_tara, p_fecha, 'bruto', p_notas, p_fotos_entrada, p_registrado_por
  ) returning id into v_id;

  insert into transformacion_entrada_detalle (transformacion_id, producto_id, peso_kg)
  values (v_id, p_producto_entrada_id, v_peso_neto);

  return v_id;
end;
$function$
;
