-- Salidas mixtas de transformaciones (PCB y ferroso/no ferroso).
-- Función NUEVA; no reemplaza completar_transformacion_ferroso / _pcb.
-- Args: p_transformacion_id uuid, p_salidas jsonb, p_completado_por uuid
--
-- Cada salida (claves snake_case): tipo ('material'|'lote'), producto_id,
-- lote_destino_id, almacen_id, peso_bruto, tara, fotos (text[]).
--
-- Tipos de fila resultantes en transformacion_salida_detalle:
--   A) material suelto:   producto_id sí, lote_destino_id NULL
--   B) lote heredado:     producto_id NULL, lote_destino_id sí (PCB; composición
--                         por distribución de la entrada)
--   C) lote con producto: producto_id sí y lote_destino_id sí (ferroso -> lote)
--
-- Reglas por categoría + tipo:
--   pcb + lote:         lote_destino_id obligatorio y != lote_origen_id; producto_id
--                       se fuerza a NULL (tipo B); almacen_id obligatorio.
--   pcb + material:     producto_id y almacen_id obligatorios (tipo A).
--   ferroso + material: producto_id obligatorio; almacen_id opcional (default
--                       = almacén de la transformación) (tipo A).
--   ferroso + lote:     producto_id, lote_destino_id y almacen_id obligatorios (tipo C).
-- Comunes: neto > 0, suma de salidas <= peso_neto de entrada + 0.01, lote y
-- almacén activos, producto existente y activo, fotos obligatorias solo en
-- ferroso. No valida toma física.

CREATE OR REPLACE FUNCTION public.completar_transformacion_mixta(
  p_transformacion_id uuid,
  p_salidas jsonb,
  p_completado_por uuid
)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_categoria         text;
  v_estado            text;
  v_lote_origen_id    uuid;
  v_almacen_trans     uuid;
  v_peso_neto_entrada numeric;
  v_item              jsonb;
  v_tipo              text;
  v_producto          uuid;
  v_lote_destino      uuid;
  v_almacen           uuid;
  v_peso_bruto        numeric;
  v_tara              numeric;
  v_neto              numeric;
  v_suma_salidas      numeric := 0;
  v_fotos             text[];
  v_salidas_norm      jsonb := '[]'::jsonb;
begin
  select t.categoria, t.estado, t.lote_origen_id, t.almacen_id, t.peso_neto
    into v_categoria, v_estado, v_lote_origen_id, v_almacen_trans, v_peso_neto_entrada
    from public.transformaciones t
   where t.id = p_transformacion_id
     for update;

  if v_categoria is null then
    raise exception 'Transformación no encontrada.';
  end if;
  if v_categoria not in ('pcb', 'ferroso_no_ferroso') then
    raise exception 'Categoría de transformación no soportada: %.', v_categoria;
  end if;
  if v_estado <> 'bruto' then
    raise exception 'Esta transformación ya fue completada.';
  end if;

  if p_salidas is null or jsonb_typeof(p_salidas) <> 'array' or jsonb_array_length(p_salidas) = 0 then
    raise exception 'Agrega al menos una salida.';
  end if;

  -- Validación y normalización (no se inserta nada hasta validar todo).
  for v_item in select value from jsonb_array_elements(p_salidas) as elems(value)
  loop
    v_tipo         := v_item->>'tipo';
    begin
      v_producto     := nullif(v_item->>'producto_id', '')::uuid;
      v_lote_destino := nullif(v_item->>'lote_destino_id', '')::uuid;
      v_almacen      := nullif(v_item->>'almacen_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'producto_id, lote_destino_id o almacen_id de una salida no es un uuid válido.';
    end;
    begin
      v_peso_bruto := nullif(v_item->>'peso_bruto', '')::numeric;
      v_tara       := coalesce(nullif(v_item->>'tara', '')::numeric, 0);
    exception when invalid_text_representation then
      raise exception 'peso_bruto o tara de una salida no es un número válido.';
    end;

    if v_tipo is null or v_tipo not in ('material', 'lote') then
      raise exception 'Cada salida debe indicar tipo ''material'' o ''lote''.';
    end if;
    if v_peso_bruto is null
       or v_peso_bruto in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
       or v_tara in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
       or v_tara < 0 then
      raise exception 'Peso bruto o tara inválidos en una salida.';
    end if;
    v_neto := v_peso_bruto - v_tara;
    if round(v_neto, 2) <= 0 then
      raise exception 'El peso neto de cada salida debe ser mayor a 0.';
    end if;

    if v_categoria = 'pcb' and v_tipo = 'lote' then
      if v_lote_destino is null then
        raise exception 'Cada salida de tipo lote necesita lote_destino_id.';
      end if;
      if v_lote_destino = v_lote_origen_id then
        raise exception 'El lote destino debe ser distinto del lote origen.';
      end if;
      if v_almacen is null then
        raise exception 'Cada salida a lote necesita almacen_id.';
      end if;
      v_producto := null;                       -- tipo B: composición heredada
    elsif v_categoria = 'pcb' and v_tipo = 'material' then
      if v_producto is null then
        raise exception 'Cada salida de tipo material necesita producto_id.';
      end if;
      if v_almacen is null then
        raise exception 'Cada salida de tipo material necesita almacen_id.';
      end if;
      v_lote_destino := null;                   -- tipo A
    elsif v_tipo = 'material' then              -- ferroso + material
      if v_producto is null then
        raise exception 'Cada salida de tipo material necesita producto_id.';
      end if;
      v_almacen := coalesce(v_almacen, v_almacen_trans);
      v_lote_destino := null;                   -- tipo A
    else                                        -- ferroso + lote (tipo C)
      if v_producto is null or v_lote_destino is null or v_almacen is null then
        raise exception 'Una salida ferroso a lote necesita producto_id, lote_destino_id y almacen_id.';
      end if;
    end if;

    if v_categoria = 'ferroso_no_ferroso'
       and (case when jsonb_typeof(v_item->'fotos') = 'array'
                 then jsonb_array_length(v_item->'fotos') else 0 end) = 0 then
      raise exception 'Cada salida necesita al menos una foto.';
    end if;

    if v_lote_destino is not null
       and not exists (select 1 from public.lotes where id = v_lote_destino and activo) then
      raise exception 'Lote destino % no encontrado o archivado.', v_lote_destino;
    end if;
    if v_almacen is not null
       and not exists (select 1 from public.almacenes where id = v_almacen and activo) then
      raise exception 'Almacén destino % no encontrado o inactivo.', v_almacen;
    end if;
    if v_producto is not null
       and not exists (select 1 from public.productos where id = v_producto and activo) then
      raise exception 'Producto % no encontrado o inactivo.', v_producto;
    end if;

    v_suma_salidas := v_suma_salidas + v_neto;
    v_salidas_norm := v_salidas_norm || jsonb_build_array(jsonb_build_object(
      'producto_id',     v_producto,
      'lote_destino_id', v_lote_destino,
      'almacen_id',      v_almacen,
      'peso_bruto',      v_peso_bruto,
      'tara',            v_tara,
      'fotos',           case when jsonb_typeof(v_item->'fotos') = 'array' then v_item->'fotos' else '[]'::jsonb end
    ));
  end loop;

  if v_suma_salidas > v_peso_neto_entrada + 0.01 then
    raise exception 'La suma de las salidas (%) supera el peso neto de entrada (%).',
      round(v_suma_salidas, 2), round(v_peso_neto_entrada, 2);
  end if;

  for v_item in select value from jsonb_array_elements(v_salidas_norm) as elems(value)
  loop
    v_fotos := coalesce(array(select jsonb_array_elements_text(v_item->'fotos')), '{}');
    insert into public.transformacion_salida_detalle
      (transformacion_id, producto_id, lote_destino_id, almacen_id, peso_bruto, tara, fotos)
    values (
      p_transformacion_id,
      nullif(v_item->>'producto_id', '')::uuid,
      nullif(v_item->>'lote_destino_id', '')::uuid,
      nullif(v_item->>'almacen_id', '')::uuid,
      (v_item->>'peso_bruto')::numeric,
      (v_item->>'tara')::numeric,
      v_fotos
    );
  end loop;

  update public.transformaciones
     set estado = 'completa', completado_por = p_completado_por, completado_en = now()
   where id = p_transformacion_id;
end;
$function$
;

-- Solo el backend (service_role) debe poder invocarla.
REVOKE EXECUTE ON FUNCTION public.completar_transformacion_mixta(uuid, jsonb, uuid) FROM public, anon, authenticated;
