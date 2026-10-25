-- =============================================================================
-- Agregar salidas (pesadas adicionales) al editar una transformación completa
-- =============================================================================
-- NO APLICADA TODAVÍA. Requiere migration_editar_transformacion_pesos.sql ya aplicada
-- (usa stock_claves_transformacion y hay_toma_fisica_abierta_lote).
--
-- Agrega el parámetro p_salidas_nuevas a editar_transformacion_pesos. Como cambia la
-- firma, se borra la versión de 7 argumentos (si no, PostgREST ve dos sobrecargas
-- y responde PGRST203). El backend manda siempre los 8 argumentos.
--
-- ROLLBACK: drop function public.editar_transformacion_pesos(uuid, numeric, numeric,
-- jsonb, date, text, boolean, jsonb); y reaplicar migration_editar_transformacion_pesos.sql
-- (recrea la de 7 argumentos).
--
-- Reglas de cada salida nueva: las de completar_transformacion_mixta (tipo
-- material|lote, neto > 0, fotos obligatorias en ferroso, lote/almacén/producto
-- activos). Un lote destino SIN almacen_id va al almacén de la transformación o,
-- si no tiene, al predeterminado (el lote no fija almacén). La suma de TODAS las
-- salidas (existentes + nuevas) no puede superar el neto de entrada + 0.01. Toma
-- física abierta y stock negativo se validan igual que para los pesos editados,
-- en la misma transacción.
-- =============================================================================

begin;

drop function if exists public.editar_transformacion_pesos(uuid, numeric, numeric, jsonb, date, text, boolean);

create or replace function public.editar_transformacion_pesos(
  p_transformacion_id uuid,
  p_peso_bruto        numeric default null,
  p_tara              numeric default null,
  p_salidas           jsonb   default null,  -- [{ "id": uuid, "peso_bruto": n?, "tara": n? }]
  p_fecha             date    default null,
  p_notas             text    default null,
  p_set_notas         boolean default false,
  p_salidas_nuevas    jsonb   default null   -- [{ tipo, producto_id, lote_destino_id, almacen_id, peso_bruto, tara, fotos }]
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  c_tol_balance constant numeric := 0.01;
  c_tol_stock   constant numeric := 0.001;
  c_msg_toma    constant text := 'Hay una toma física de inventario abierta para uno de los materiales o lotes afectados. No se pueden editar pesos hasta cerrarla.';

  v_t                 public.transformaciones%rowtype;
  v_s                 public.transformacion_salida_detalle%rowtype;
  v_item              jsonb;
  v_sid               uuid;
  v_ids               uuid[] := '{}';
  v_norm              jsonb := '[]'::jsonb;      -- salidas normalizadas (solo las enviadas)
  v_cambian           uuid[] := '{}';            -- salidas cuyo peso cambia
  v_sb                numeric;
  v_st                numeric;
  v_bruto             numeric;
  v_tara              numeric;
  v_neto_ant          numeric;
  v_neto_nuevo        numeric;
  v_suma_salidas      numeric;
  v_neto_cambia       boolean;
  v_pesos_cambian     boolean;
  v_factor            numeric;
  v_suma_ent_ant      numeric;
  v_resto             numeric;
  v_ent               record;
  v_alm               uuid;
  v_almacenes         uuid[];
  v_antes             jsonb;
  v_despues           jsonb;
  v_viol              record;
  v_stock_cambios     jsonb := '[]'::jsonb;
  -- salidas nuevas (pesadas adicionales)
  v_nuevas_norm       jsonb := '[]'::jsonb;
  v_neto_nuevas       numeric := 0;
  v_n_ids             uuid[] := '{}';
  v_alm_def           uuid;
  v_n_tipo            text;
  v_n_prod            uuid;
  v_n_lote            uuid;
  v_n_alm             uuid;
  v_n_bruto           numeric;
  v_n_tara            numeric;
  v_n_neto            numeric;
  v_i                 integer;
begin
  select * into v_t from public.transformaciones where id = p_transformacion_id for update;
  if not found then
    raise exception 'Transformación no encontrada.';
  end if;
  if v_t.categoria not in ('pcb', 'ferroso_no_ferroso') then
    raise exception 'Categoría de transformación no soportada: %.', v_t.categoria;
  end if;

  -- ---- Salidas enviadas: validar y normalizar (aún sin escribir nada) ------
  if p_salidas is not null then
    if jsonb_typeof(p_salidas) <> 'array' then
      raise exception 'p_salidas debe ser un arreglo.';
    end if;
    if jsonb_array_length(p_salidas) > 0 and v_t.estado <> 'completa' then
      raise exception 'Esta transformación aún no tiene salidas: solo se pueden editar los pesos de entrada.';
    end if;

    for v_item in select value from jsonb_array_elements(p_salidas) as elems(value)
    loop
      begin
        v_sid := (v_item->>'id')::uuid;
        v_sb  := nullif(v_item->>'peso_bruto', '')::numeric;
        v_st  := nullif(v_item->>'tara', '')::numeric;
      exception when invalid_text_representation then
        raise exception 'Id, peso bruto o tara de una salida no es válido.';
      end;
      if v_sid is null or v_sid = any(v_ids) then
        raise exception 'Hay salidas repetidas o sin id en la edición.';
      end if;
      v_ids := v_ids || v_sid;

      select * into v_s from public.transformacion_salida_detalle
       where id = v_sid and transformacion_id = p_transformacion_id;
      if not found then
        raise exception 'Alguna salida no pertenece a esta transformación.';
      end if;

      v_sb := coalesce(v_sb, v_s.peso_bruto);
      v_st := coalesce(v_st, v_s.tara);
      if v_sb in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
         or v_st in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
         or v_sb < 0 or v_st < 0 then
        raise exception 'Peso bruto o tara inválidos en una salida.';
      end if;
      if round(v_sb - v_st, 2) <= 0 then
        raise exception 'El peso neto de cada salida debe ser mayor a 0.';
      end if;

      v_norm := v_norm || jsonb_build_array(
        jsonb_build_object('id', v_sid, 'peso_bruto', v_sb, 'tara', v_st));
      if v_sb <> v_s.peso_bruto or v_st <> v_s.tara then
        v_cambian := v_cambian || v_sid;
      end if;
    end loop;
  end if;

  -- ---- Salidas NUEVAS (pesadas adicionales): validar y normalizar ----------
  -- Mismas reglas que completar_transformacion_mixta. Un lote destino sin
  -- almacen_id queda en el almacén de la transformación (o, si no tiene, en el
  -- predeterminado): el lote no fija almacén por sí mismo.
  if p_salidas_nuevas is not null and jsonb_typeof(p_salidas_nuevas) <> 'array' then
    raise exception 'p_salidas_nuevas debe ser un arreglo.';
  end if;
  if p_salidas_nuevas is not null and jsonb_array_length(p_salidas_nuevas) > 0 then
    if v_t.estado <> 'completa' then
      raise exception 'Solo se pueden agregar salidas a una transformación completada.';
    end if;
    v_alm_def := coalesce(v_t.almacen_id,
                          (select id from public.almacenes where es_predeterminado and activo limit 1));

    for v_item in select value from jsonb_array_elements(p_salidas_nuevas) as elems(value)
    loop
      v_n_tipo := v_item->>'tipo';
      begin
        v_n_prod  := nullif(v_item->>'producto_id', '')::uuid;
        v_n_lote  := nullif(v_item->>'lote_destino_id', '')::uuid;
        v_n_alm   := nullif(v_item->>'almacen_id', '')::uuid;
        v_n_bruto := nullif(v_item->>'peso_bruto', '')::numeric;
        v_n_tara  := coalesce(nullif(v_item->>'tara', '')::numeric, 0);
      exception when invalid_text_representation then
        raise exception 'Una salida nueva tiene ids o pesos inválidos.';
      end;
      if v_n_tipo is null or v_n_tipo not in ('material', 'lote') then
        raise exception 'Cada salida nueva debe indicar tipo ''material'' o ''lote''.';
      end if;
      if v_n_bruto is null
         or v_n_bruto in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
         or v_n_tara in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
         or v_n_tara < 0 then
        raise exception 'Peso bruto o tara inválidos en una salida nueva.';
      end if;
      v_n_neto := v_n_bruto - v_n_tara;
      if round(v_n_neto, 2) <= 0 then
        raise exception 'El peso neto de cada salida nueva debe ser mayor a 0.';
      end if;

      if v_t.categoria = 'pcb' and v_n_tipo = 'lote' then
        if v_n_lote is null then raise exception 'Cada salida nueva a lote necesita lote_destino_id.'; end if;
        if v_n_lote = v_t.lote_origen_id then
          raise exception 'El lote destino debe ser distinto del lote origen.';
        end if;
        v_n_prod := null;                              -- composición heredada
        v_n_alm  := coalesce(v_n_alm, v_alm_def);
      elsif v_t.categoria = 'pcb' then                 -- pcb + material
        if v_n_prod is null or v_n_alm is null then
          raise exception 'Cada salida nueva de tipo material necesita producto_id y almacen_id.';
        end if;
        v_n_lote := null;
      elsif v_n_tipo = 'material' then                 -- ferroso + material
        if v_n_prod is null then raise exception 'Cada salida nueva de tipo material necesita producto_id.'; end if;
        v_n_alm  := coalesce(v_n_alm, v_alm_def);
        v_n_lote := null;
      else                                             -- ferroso + lote
        if v_n_prod is null or v_n_lote is null then
          raise exception 'Una salida nueva ferroso a lote necesita producto_id y lote_destino_id.';
        end if;
        v_n_alm := coalesce(v_n_alm, v_alm_def);
      end if;
      if v_n_alm is null then
        raise exception 'No se pudo determinar el almacén de una salida nueva (la transformación no tiene almacén ni hay uno predeterminado).';
      end if;

      if v_t.categoria = 'ferroso_no_ferroso'
         and (case when jsonb_typeof(v_item->'fotos') = 'array'
                   then jsonb_array_length(v_item->'fotos') else 0 end) = 0 then
        raise exception 'Cada salida nueva necesita al menos una foto.';
      end if;
      if v_n_lote is not null and not exists (select 1 from public.lotes where id = v_n_lote and activo) then
        raise exception 'Lote destino % no encontrado o archivado.', v_n_lote;
      end if;
      if not exists (select 1 from public.almacenes where id = v_n_alm and activo) then
        raise exception 'Almacén destino % no encontrado o inactivo.', v_n_alm;
      end if;
      if v_n_prod is not null and not exists (select 1 from public.productos where id = v_n_prod and activo) then
        raise exception 'Producto % no encontrado o inactivo.', v_n_prod;
      end if;

      v_neto_nuevas := v_neto_nuevas + v_n_neto;
      v_nuevas_norm := v_nuevas_norm || jsonb_build_array(jsonb_build_object(
        'producto_id', v_n_prod, 'lote_destino_id', v_n_lote, 'almacen_id', v_n_alm,
        'peso_bruto', v_n_bruto, 'tara', v_n_tara,
        'fotos', case when jsonb_typeof(v_item->'fotos') = 'array' then v_item->'fotos' else '[]'::jsonb end));
    end loop;
  end if;

  -- ---- Entrada --------------------------------------------------------------
  v_bruto := coalesce(p_peso_bruto, v_t.peso_bruto);
  v_tara  := coalesce(p_tara, v_t.tara);
  if v_bruto in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     or v_tara in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     or v_bruto < 0 or v_tara < 0 then
    raise exception 'Peso bruto o tara de entrada inválidos.';
  end if;
  v_neto_ant   := v_t.peso_neto;
  v_neto_nuevo := v_bruto - v_tara;
  if v_neto_nuevo <= 0 then
    raise exception 'El peso neto de entrada debe ser mayor a 0.';
  end if;
  v_neto_cambia   := round(v_neto_nuevo, 4) <> round(v_neto_ant, 4);
  v_pesos_cambian := v_neto_cambia or array_length(v_cambian, 1) is not null or v_neto_nuevas > 0;

  -- ---- Balance: suma de TODAS las salidas (editadas y no) vs entrada --------
  select coalesce(sum(case when n.id is not null then n.peso_bruto - n.tara else s.peso_neto end), 0) + v_neto_nuevas
    into v_suma_salidas
    from public.transformacion_salida_detalle s
    left join jsonb_to_recordset(v_norm) as n(id uuid, peso_bruto numeric, tara numeric) on n.id = s.id
   where s.transformacion_id = p_transformacion_id;
  if v_suma_salidas > v_neto_nuevo + c_tol_balance then
    raise exception 'Las salidas suman % kg y superan el peso neto de entrada (% kg).',
      round(v_suma_salidas, 2), round(v_neto_nuevo, 2);
  end if;

  -- Las salidas nuevas se insertan ya (con neto casi 0: bruto = tara + 0.0001) para
  -- que la foto "antes" del stock incluya sus claves; el peso real se fija en la
  -- escritura. Entran a v_cambian para pasar por el chequeo de toma física y el
  -- bloqueo de almacenes. Si algo falla, toda la transacción se revierte.
  if jsonb_array_length(v_nuevas_norm) > 0 then
    for v_item in select value from jsonb_array_elements(v_nuevas_norm) as elems(value)
    loop
      insert into public.transformacion_salida_detalle
        (transformacion_id, producto_id, lote_destino_id, almacen_id, peso_bruto, tara, fotos)
      values (
        p_transformacion_id,
        nullif(v_item->>'producto_id', '')::uuid,
        nullif(v_item->>'lote_destino_id', '')::uuid,
        nullif(v_item->>'almacen_id', '')::uuid,
        (v_item->>'tara')::numeric + 0.0001,
        (v_item->>'tara')::numeric,
        coalesce(array(select jsonb_array_elements_text(v_item->'fotos')), '{}')
      ) returning id into v_sid;
      v_n_ids := v_n_ids || v_sid;
    end loop;
    v_cambian := v_cambian || v_n_ids;
  end if;

  if v_pesos_cambian then
    -- ---- Toma física abierta sobre lo que cambia ----------------------------
    if v_neto_cambia then
      for v_ent in
        select producto_id from public.transformacion_entrada_detalle
         where transformacion_id = p_transformacion_id and producto_id is not null
      loop
        if public.hay_toma_fisica_abierta(v_t.almacen_id, v_ent.producto_id, v_t.lote_origen_id) then
          raise exception '%', c_msg_toma;
        end if;
      end loop;
      if v_t.lote_origen_id is not null
         and not exists (select 1 from public.transformacion_entrada_detalle
                          where transformacion_id = p_transformacion_id and producto_id is not null)
         and public.hay_toma_fisica_abierta_lote(v_t.almacen_id, v_t.lote_origen_id) then
        raise exception '%', c_msg_toma;
      end if;
    end if;

    for v_s in
      select * from public.transformacion_salida_detalle
       where transformacion_id = p_transformacion_id and id = any(v_cambian)
    loop
      v_alm := coalesce(v_s.almacen_id, v_t.almacen_id);
      if v_s.producto_id is not null then
        if public.hay_toma_fisica_abierta(v_alm, v_s.producto_id, v_s.lote_destino_id) then
          raise exception '%', c_msg_toma;
        end if;
      elsif v_s.lote_destino_id is not null then
        for v_ent in
          select producto_id from public.transformacion_entrada_detalle
           where transformacion_id = p_transformacion_id and producto_id is not null
        loop
          if public.hay_toma_fisica_abierta(v_alm, v_ent.producto_id, v_s.lote_destino_id) then
            raise exception '%', c_msg_toma;
          end if;
        end loop;
        if not exists (select 1 from public.transformacion_entrada_detalle
                        where transformacion_id = p_transformacion_id and producto_id is not null)
           and public.hay_toma_fisica_abierta_lote(v_alm, v_s.lote_destino_id) then
          raise exception '%', c_msg_toma;
        end if;
      end if;
    end loop;

    -- ---- Bloqueo de almacenes implicados (orden fijo: sin deadlocks) --------
    select array_agg(distinct a) into v_almacenes
      from (
        select v_t.almacen_id as a
        union
        select coalesce(s.almacen_id, v_t.almacen_id)
          from public.transformacion_salida_detalle s where s.transformacion_id = p_transformacion_id
      ) x where a is not null;
    perform 1 from public.almacenes where id = any(v_almacenes) order by id for update;

    -- ---- Stock ANTES (mismas funciones que el inventario) -------------------
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_antes
      from public.stock_claves_transformacion(p_transformacion_id) x;
  end if;

  -- ---- Escritura -------------------------------------------------------------
  update public.transformaciones
     set peso_bruto = v_bruto,
         tara       = v_tara,
         fecha      = coalesce(p_fecha, fecha),
         notas      = case when p_set_notas then nullif(btrim(coalesce(p_notas, '')), '') else notas end
   where id = p_transformacion_id;

  if v_neto_cambia then
    -- El detalle de entrada es lo que descuenta stock: se reescala al nuevo neto.
    select coalesce(sum(peso_kg), 0) into v_suma_ent_ant
      from public.transformacion_entrada_detalle where transformacion_id = p_transformacion_id;
    v_factor := v_neto_nuevo / v_neto_ant;

    update public.transformacion_entrada_detalle
       set peso_kg = round(peso_kg * v_factor, 4)
     where transformacion_id = p_transformacion_id;

    -- Solo si el detalle sumaba el neto anterior se absorbe el residuo de redondeo.
    if abs(v_suma_ent_ant - v_neto_ant) < 0.0001 then
      select round(v_neto_nuevo, 4) - coalesce(sum(peso_kg), 0) into v_resto
        from public.transformacion_entrada_detalle where transformacion_id = p_transformacion_id;
      if abs(v_resto) >= 0.00005 then
        update public.transformacion_entrada_detalle
           set peso_kg = peso_kg + v_resto
         where id = (
           select id from public.transformacion_entrada_detalle
            where transformacion_id = p_transformacion_id
            order by peso_kg desc, id limit 1);
      end if;
    end if;
  end if;

  update public.transformacion_salida_detalle d
     set peso_bruto = n.peso_bruto, tara = n.tara
    from jsonb_to_recordset(v_norm) as n(id uuid, peso_bruto numeric, tara numeric)
   where d.id = n.id and d.transformacion_id = p_transformacion_id
     and (d.peso_bruto <> n.peso_bruto or d.tara <> n.tara);

  -- Peso real de las salidas nuevas (antes eran un marcador de neto casi 0).
  if array_length(v_n_ids, 1) is not null then
    for v_i in 1 .. array_length(v_n_ids, 1)
    loop
      update public.transformacion_salida_detalle
         set peso_bruto = (v_nuevas_norm->(v_i - 1)->>'peso_bruto')::numeric
       where id = v_n_ids[v_i];
    end loop;
  end if;

  -- ---- Stock DESPUÉS y verificación de negativos ------------------------------
  if v_pesos_cambian then
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_despues
      from public.stock_claves_transformacion(p_transformacion_id) x;

    select d.etiqueta, d.stock as despues, coalesce(a.stock, 0) as antes
      into v_viol
      from jsonb_to_recordset(v_despues) as d(clave text, etiqueta text, stock numeric)
      left join jsonb_to_recordset(v_antes) as a(clave text, stock numeric) on a.clave = d.clave
     where d.stock < -c_tol_stock and d.stock < coalesce(a.stock, 0) - c_tol_stock
     order by d.etiqueta
     limit 1;
    if found then
      raise exception 'Stock insuficiente: % pasaría de % kg a % kg. Ajusta los pesos o registra primero la entrada que falta.',
        v_viol.etiqueta, round(v_viol.antes, 2), round(v_viol.despues, 2);
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'etiqueta', coalesce(d.etiqueta, a.etiqueta),
             'antes', round(coalesce(a.stock, 0), 3),
             'despues', round(coalesce(d.stock, 0), 3))
           order by coalesce(d.etiqueta, a.etiqueta)), '[]'::jsonb)
      into v_stock_cambios
      from jsonb_to_recordset(v_despues) as d(clave text, etiqueta text, stock numeric)
      full join jsonb_to_recordset(v_antes) as a(clave text, etiqueta text, stock numeric) on a.clave = d.clave
     where abs(coalesce(d.stock, 0) - coalesce(a.stock, 0)) > 0.0005;
  end if;

  return jsonb_build_object('facturaCompraId', v_t.factura_compra_id, 'stock', v_stock_cambios);
end;
$function$;

do $$ declare r record; begin for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace='public'::regnamespace and p.proname = 'editar_transformacion_pesos' loop execute format('revoke execute on function %s from public, anon, authenticated', r.f); end loop; end $$;

commit;
