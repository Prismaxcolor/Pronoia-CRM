-- =============================================================================
-- MIGRACIÓN: Fuente única de verdad para stock en transformaciones y traslados.
--
-- CONTEXTO: la ronda anterior (migration_fix_stock_ajustes_inventario.sql)
-- corrigió stock_lote_por_producto()/stock_lote_total() para incluir
-- ajustes_inventario, y crear_transformacion_pcb() para validar contra el
-- total real del lote. Esta migración extiende el mismo criterio a los
-- mecanismos que quedaban sin auditar: transformaciones regulares (no-PCB),
-- traslados entre almacenes y transformaciones ferroso/no-ferroso.
--
-- BUGS ENCONTRADOS Y CORREGIDOS:
--
-- 1. crear_transformacion() (transformación regular, no-PCB) validaba el
--    peso de entrada contra sum(stock_lote_por_producto()) — el mismo bug
--    que ya se había corregido en crear_transformacion_pcb() pero que NO se
--    replicó aquí. Un lote con un ajuste de toma física sin desglose por
--    producto (ajustes_inventario.producto_id IS NULL) mostraba "solo hay X
--    kg disponibles" con X menor al stock real, o permitía sacar más de lo
--    que en realidad había. Ahora valida contra stock_lote_total() (que sí
--    incluye esos ajustes) y distribuye el remanente no identificado como
--    una fila de transformacion_entrada_detalle con producto_id NULL, igual
--    que ya hacía la versión PCB.
--
-- 2. crear_traslado() no validaba stock disponible en el almacén de origen
--    en absoluto — se podía trasladar más kg de un producto de los que
--    existían físicamente en ese almacén, dejando stock_almacen(origen)
--    en negativo una vez completado el traslado. Ahora valida contra
--    stock_almacen(), sumando primero las filas repetidas del mismo
--    producto dentro del mismo traslado (distintas subcategorías) antes de
--    comparar contra lo disponible.
--
-- 3. crear_transformacion_ferroso() tampoco validaba stock disponible del
--    producto de entrada en el almacén — mismo problema que el punto 2,
--    ahora corregido validando contra stock_almacen().
--
-- CÓMO APLICAR: pegar en Supabase Studio → SQL Editor y ejecutar. Ya se
-- aplicó directamente en producción vía Management API el 2026-09-09; este
-- archivo documenta el cambio para otros ambientes.
-- =============================================================================

-- 1. crear_transformacion: valida contra el total real del lote, no solo la
--    suma de stock conocido por producto, y distribuye el remanente sin
--    desglose como fila con producto_id NULL.
create or replace function public.crear_transformacion(p_lote_origen_id uuid, p_peso_bruto numeric, p_tara numeric, p_fecha date, p_notas text, p_registrado_por uuid)
 returns uuid
 language plpgsql
as $function$
declare
  v_id                 uuid;
  v_neto               numeric;
  v_total_disponible   numeric;
  v_total_conocido     numeric;
  v_total_distribuido  numeric := 0;
  v_prod               record;
  v_prod_kg            numeric;
  v_null_kg            numeric;
  v_nombre_lote        text;
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

  if v_neto > v_total_disponible + 0.01 then
    raise exception 'Solo hay % kg disponibles en %.', round(v_total_disponible, 2), v_nombre_lote;
  end if;

  insert into public.transformaciones
    (lote_origen_id, peso_bruto, tara, fecha, estado, notas, registrado_por)
  values
    (p_lote_origen_id, p_peso_bruto, coalesce(p_tara, 0), coalesce(p_fecha, current_date),
     'bruto', nullif(p_notas, ''), p_registrado_por)
  returning id into v_id;

  select coalesce(sum(stock), 0) into v_total_conocido
    from public.stock_lote_por_producto(p_lote_origen_id)
   where stock > 0;

  if v_total_conocido > 0 then
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
$function$;

-- 2. crear_traslado: agrega validación de stock disponible en el almacén de
--    origen (antes no validaba nada).
create or replace function public.crear_traslado(p_almacen_origen_id uuid, p_almacen_destino_id uuid, p_observaciones text, p_materiales jsonb, p_pesado_por uuid)
 returns uuid
 language plpgsql
as $function$
declare
  v_id   uuid;
  v_item jsonb;
  v_prod record;
  v_disponible numeric;
  v_nombre text;
begin
  if p_almacen_origen_id = p_almacen_destino_id then
    raise exception 'El almacén de origen y destino no pueden ser el mismo.';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_materiales, '[]'::jsonb)) as elems(value)
  loop
    if public.hay_toma_fisica_abierta(p_almacen_origen_id, (v_item->>'producto_id')::uuid)
       or public.hay_toma_fisica_abierta(p_almacen_destino_id, (v_item->>'producto_id')::uuid) then
      raise exception 'Uno de los materiales tiene una toma física de inventario abierta en el origen o el destino. No se pueden registrar traslados hasta cerrarla.';
    end if;
  end loop;

  for v_prod in
    select (elems.value->>'producto_id')::uuid as producto_id,
           sum((elems.value->>'peso_bruto')::numeric - coalesce((elems.value->>'tara')::numeric, 0)) as neto_solicitado
    from jsonb_array_elements(coalesce(p_materiales, '[]'::jsonb)) as elems(value)
    group by (elems.value->>'producto_id')::uuid
  loop
    select coalesce(stock, 0) into v_disponible
      from public.stock_almacen(p_almacen_origen_id)
     where producto_id = v_prod.producto_id;

    if v_prod.neto_solicitado > coalesce(v_disponible, 0) + 0.01 then
      select nombre into v_nombre from public.productos where id = v_prod.producto_id;
      raise exception 'Solo hay % kg disponibles de % en el almacén de origen.', round(coalesce(v_disponible, 0), 2), coalesce(v_nombre, 'este material');
    end if;
  end loop;

  insert into public.tickets_traslado
    (almacen_origen_id, almacen_destino_id, observaciones, pesado_por)
  values (
    p_almacen_origen_id, p_almacen_destino_id, nullif(p_observaciones, ''), p_pesado_por
  )
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_materiales, '[]'::jsonb)) as elems(value)
  loop
    insert into public.detalle_traslado
      (traslado_id, producto_id, subcategoria, peso_bruto, tara)
    values (
      v_id,
      (v_item->>'producto_id')::uuid,
      nullif(v_item->>'subcategoria', ''),
      (v_item->>'peso_bruto')::numeric,
      (v_item->>'tara')::numeric
    );
  end loop;

  return v_id;
end;
$function$;

-- 3. crear_transformacion_ferroso: agrega validación de stock disponible en
--    el almacén (antes no validaba nada).
create or replace function public.crear_transformacion_ferroso(p_producto_entrada_id uuid, p_almacen_id uuid, p_peso_bruto numeric, p_tara numeric, p_fecha date, p_notas text, p_fotos_entrada text[], p_registrado_por uuid)
 returns uuid
 language plpgsql
as $function$
declare
  v_peso_neto numeric;
  v_id uuid;
  v_disponible numeric;
  v_nombre text;
begin
  v_peso_neto := p_peso_bruto - p_tara;
  if v_peso_neto <= 0 then
    raise exception 'El peso neto de entrada debe ser mayor a 0.';
  end if;
  if p_fotos_entrada is null or array_length(p_fotos_entrada, 1) is null then
    raise exception 'Agrega al menos una foto de entrada.';
  end if;

  select coalesce(stock, 0) into v_disponible
    from public.stock_almacen(p_almacen_id)
   where producto_id = p_producto_entrada_id;

  if v_peso_neto > coalesce(v_disponible, 0) + 0.01 then
    select nombre into v_nombre from public.productos where id = p_producto_entrada_id;
    raise exception 'Solo hay % kg disponibles de % en este almacén.', round(coalesce(v_disponible, 0), 2), coalesce(v_nombre, 'este material');
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
$function$;

-- VERIFICACIÓN: compras/ventas se confirmaron correctas sin cambios — las
-- facturas (crear_factura_compra/crear_factura_venta) son puramente
-- documentos de facturación (header + líneas + marcar tickets facturado),
-- no mueven kg de forma independiente al ticket de pesaje ya contabilizado.
