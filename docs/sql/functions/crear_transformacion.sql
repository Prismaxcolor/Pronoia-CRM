-- Extraído de producción vía pg_get_functiondef, 11-sep-2026
-- Args: p_lote_origen_id uuid, p_peso_bruto numeric, p_tara numeric, p_fecha date, p_notas text, p_registrado_por uuid

CREATE OR REPLACE FUNCTION public.crear_transformacion(p_lote_origen_id uuid, p_peso_bruto numeric, p_tara numeric, p_fecha date, p_notas text, p_registrado_por uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_id                 uuid;
  v_neto               numeric;
  v_total_disponible   numeric;
  v_total_distribuido  numeric := 0;
  v_prod                record;
  v_prod_kg             numeric;
  v_null_kg              numeric;
  v_nombre_lote         text;
begin
  select nombre into v_nombre_lote from public.lotes where id = p_lote_origen_id for update;
  if v_nombre_lote is null then
    raise exception 'Lote origen % no encontrado.', p_lote_origen_id;
  end if;

  v_neto := coalesce(p_peso_bruto, 0) - coalesce(p_tara, 0);
  if v_neto <= 0 then
    raise exception 'El peso neto debe ser mayor a 0.';
  end if;

  v_total_disponible := public.stock_lote_total(p_lote_origen_id);

  insert into public.transformaciones
    (lote_origen_id, peso_bruto, tara, fecha, estado, notas, registrado_por)
  values
    (p_lote_origen_id, p_peso_bruto, coalesce(p_tara, 0), coalesce(p_fecha, current_date),
     'bruto', nullif(p_notas, ''), p_registrado_por)
  returning id into v_id;

  if v_total_disponible > 0 then
    for v_prod in
      select producto_id, stock from public.stock_lote_por_producto(p_lote_origen_id) where stock > 0
    loop
      v_prod_kg := round(v_neto * v_prod.stock / v_total_disponible, 4);
      if v_prod_kg > 0 then
        insert into public.transformacion_entrada_detalle (transformacion_id, producto_id, peso_kg)
        values (v_id, v_prod.producto_id, v_prod_kg);
        v_total_distribuido := v_total_distribuido + v_prod_kg;
      end if;
    end loop;
  end if;

  v_null_kg := round(v_neto - v_total_distribuido, 4);
  if v_null_kg > 0 then
    insert into public.transformacion_entrada_detalle (transformacion_id, producto_id, peso_kg)
    values (v_id, null, v_null_kg);
  end if;

  return v_id;
end;
$function$
;
