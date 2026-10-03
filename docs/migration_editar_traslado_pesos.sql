-- =============================================================================
-- Editar los pesos de un traslado (enviado y recibido) con llave de edición
-- =============================================================================
-- MIGRACIÓN ADITIVA E IDEMPOTENTE (create or replace). No toca tablas ni datos
-- existentes y no modifica ninguna función actual. Todo en una transacción.
--
-- ROLLBACK (sin la función el backend responde 409 "aún no está habilitado"):
--   drop function if exists public.editar_traslado_pesos(uuid, jsonb, text, boolean);
--   drop function if exists public.stock_claves_traslado(uuid);
--   drop function if exists public.hay_toma_fisica_abierta_lote(uuid, uuid);
--   (también la crea migration_editar_transformacion_pesos.sql: no la borres si esa ya está aplicada.)
--
-- Mapa de dependencias de los pesos de un traslado (detalle_traslado):
--   * peso_neto es columna generada (peso_bruto - tara). El stock NO se guarda:
--     stock_almacen / stock_lote_* lo derivan en vivo:
--       - origen: -peso_neto desde que el traslado se CREA (pendiente o completo);
--       - destino: +peso_recibido solo cuando está 'completo'.
--   * Líneas de LOTE: detalle_traslado_composicion es un SNAPSHOT por producto
--     (suma = peso_neto al crear). El stock por producto del lote usa
--     peso_kg en el origen y peso_kg * peso_recibido / peso_neto en el destino.
--     Al cambiar el neto se reescala el snapshot conservando proporciones y el
--     residuo de redondeo (4 decimales) se absorbe en la fila mayor. Sin esto
--     el desglose por producto del lote no se movería con el peso.
--   * No hay valoración ni facturas ligadas a traslados.
--
-- Reglas (todas en la misma transacción; si algo falla no se guarda nada):
--   1. neto de cada línea editada > 0 (a 2 decimales); recibido solo si el
--      traslado está 'completo'; 0 <= recibido <= neto + 0.01 (igual que
--      completar_traslado).
--   2. Toma física abierta en origen o destino sobre los materiales/productos
--      del lote afectados => se rechaza (como crear/completar_traslado).
--   3. Stock: mismas funciones del sistema ANTES y DESPUÉS sobre todas las
--      claves afectadas (producto x almacén origen/destino, lote x almacén x
--      producto y total del lote x almacén). Si alguna queda < 0 y empeora
--      respecto a antes => excepción. Si ya era negativa y no empeora, no bloquea.
--   4. Se bloquean (FOR UPDATE) el traslado y los dos almacenes.
--
-- Devuelve jsonb: { "stock": [ { "etiqueta": text, "antes": n, "despues": n } ] }
-- con solo las claves de stock que cambiaron (auditoría).
-- =============================================================================

begin;

-- Toma física abierta que cubre un lote en un almacén (idéntica a la de
-- migration_editar_transformacion_pesos.sql). Solo se usa cuando el lote no
-- tiene productos atribuidos, caso en que hay_toma_fisica_abierta no puede evaluarlo.
create or replace function public.hay_toma_fisica_abierta_lote(p_almacen_id uuid, p_lote_id uuid)
returns boolean
language sql
stable
set search_path = public
as $function$
  select exists(
    select 1 from public.tomas_fisicas_inventario t
    where t.almacen_id = p_almacen_id
      and t.estado = 'abierta'
      and (t.lote_ids is null or array_length(t.lote_ids, 1) is null or p_lote_id = any(t.lote_ids))
  );
$function$;

create or replace function public.stock_claves_traslado(p_traslado_id uuid)
returns table(
  clave text, etiqueta text, stock numeric,
  tipo text, almacen_id uuid, lote_id uuid, producto_id uuid
)
language sql
stable
set search_path = public
as $function$
  with t as (
    select id, almacen_origen_id as origen, almacen_destino_id as destino
    from public.tickets_traslado where id = p_traslado_id
  ),
  dt as (
    select id, producto_id, lote_id from public.detalle_traslado where traslado_id = p_traslado_id
  ),
  prod as (
    select dt.producto_id from dt where dt.producto_id is not null
    union
    select c.producto_id
      from public.detalle_traslado_composicion c join dt on dt.id = c.detalle_traslado_id
     where c.producto_id is not null
  ),
  alm as (
    select origen as almacen_id from t union select destino from t
  ),
  pa as (
    select alm.almacen_id, prod.producto_id from alm cross join prod
  ),
  la as (
    select distinct dt.lote_id, alm.almacen_id from dt cross join alm where dt.lote_id is not null
  ),
  stock_pa as (
    select a.almacen_id, s.producto_id, s.stock
    from alm a cross join lateral public.stock_almacen(a.almacen_id) s
  )
  select 'pa|' || pa.almacen_id || '|' || pa.producto_id,
         p.nombre || ' en ' || al.nombre,
         coalesce(sp.stock, 0)::numeric,
         'producto_almacen', pa.almacen_id, null::uuid, pa.producto_id
  from pa
  join public.productos p on p.id = pa.producto_id
  join public.almacenes al on al.id = pa.almacen_id
  left join stock_pa sp on sp.almacen_id = pa.almacen_id and sp.producto_id = pa.producto_id
  union all
  select 'lp|' || la.lote_id || '|' || la.almacen_id || '|' || slp.producto_id,
         'el lote ' || l.nombre || ' (' || p.nombre || ') en ' || al.nombre,
         slp.stock::numeric,
         'lote_producto', la.almacen_id, la.lote_id, slp.producto_id
  from la
  cross join lateral public.stock_lote_almacen_por_producto(la.lote_id, la.almacen_id) slp
  join public.lotes l on l.id = la.lote_id
  join public.productos p on p.id = slp.producto_id
  join public.almacenes al on al.id = la.almacen_id
  union all
  select 'lt|' || la.lote_id || '|' || la.almacen_id,
         'el lote ' || l.nombre || ' en ' || al.nombre,
         public.stock_lote_almacen_total(la.lote_id, la.almacen_id)::numeric,
         'lote_total', la.almacen_id, la.lote_id, null::uuid
  from la
  join public.lotes l on l.id = la.lote_id
  join public.almacenes al on al.id = la.almacen_id;
$function$;

create or replace function public.editar_traslado_pesos(
  p_traslado_id      uuid,
  p_lineas           jsonb   default null,  -- [{ "id": uuid, "peso_bruto": n?, "tara": n?, "peso_recibido": n? }]
  p_observaciones    text    default null,
  p_set_observaciones boolean default false
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  c_tol_recepcion constant numeric := 0.01;
  c_tol_stock     constant numeric := 0.001;
  c_msg_toma      constant text := 'Hay una toma física de inventario abierta en el origen o el destino para uno de los materiales afectados. No se pueden editar pesos hasta cerrarla.';

  v_t             public.tickets_traslado%rowtype;
  v_l             public.detalle_traslado%rowtype;
  v_item          jsonb;
  v_lid           uuid;
  v_ids           uuid[] := '{}';
  v_norm          jsonb := '[]'::jsonb;
  v_cambian       uuid[] := '{}';
  v_bruto         numeric;
  v_tara          numeric;
  v_recibido      numeric;
  v_neto          numeric;
  v_nombre        text;
  v_factor        numeric;
  v_suma_comp_ant numeric;
  v_resto         numeric;
  v_comp          record;
  v_hay_prod      boolean;
  v_n             record;
  v_almacenes     uuid[];
  v_antes         jsonb;
  v_despues       jsonb;
  v_viol          record;
  v_stock_cambios jsonb := '[]'::jsonb;
begin
  select * into v_t from public.tickets_traslado where id = p_traslado_id for update;
  if not found then
    raise exception 'Traslado no encontrado.';
  end if;

  -- ---- Líneas enviadas: validar y normalizar (aún sin escribir) -------------
  if p_lineas is not null then
    if jsonb_typeof(p_lineas) <> 'array' then
      raise exception 'p_lineas debe ser un arreglo.';
    end if;

    for v_item in select value from jsonb_array_elements(p_lineas) as elems(value)
    loop
      begin
        v_lid      := (v_item->>'id')::uuid;
        v_bruto    := nullif(v_item->>'peso_bruto', '')::numeric;
        v_tara     := nullif(v_item->>'tara', '')::numeric;
        v_recibido := nullif(v_item->>'peso_recibido', '')::numeric;
      exception when invalid_text_representation then
        raise exception 'Id o pesos de una línea no son válidos.';
      end;
      if v_lid is null or v_lid = any(v_ids) then
        raise exception 'Hay líneas repetidas o sin id en la edición.';
      end if;
      v_ids := v_ids || v_lid;

      select * into v_l from public.detalle_traslado where id = v_lid and traslado_id = p_traslado_id;
      if not found then
        raise exception 'Alguna línea no pertenece a este traslado.';
      end if;
      if v_t.estado = 'pendiente' and v_recibido is not null then
        raise exception 'Este traslado aún no fue recepcionado: no tiene peso recibido para editar.';
      end if;

      v_bruto    := coalesce(v_bruto, v_l.peso_bruto);
      v_tara     := coalesce(v_tara, v_l.tara);
      v_recibido := coalesce(v_recibido, v_l.peso_recibido);
      if v_bruto in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
         or v_tara in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
         or v_recibido in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
         or v_bruto < 0 or v_tara < 0 then
        raise exception 'Peso bruto o tara inválidos.';
      end if;
      v_neto := v_bruto - v_tara;
      if round(v_neto, 2) <= 0 then
        raise exception 'El peso neto de cada línea debe ser mayor a 0.';
      end if;
      if v_recibido is not null then
        if v_recibido < 0 then
          raise exception 'El peso recibido no puede ser negativo.';
        end if;
        if v_recibido > v_neto + c_tol_recepcion then
          select coalesce(p.nombre, lo.nombre) into v_nombre
            from public.detalle_traslado d
            left join public.productos p on p.id = d.producto_id
            left join public.lotes lo on lo.id = d.lote_id
           where d.id = v_lid;
          raise exception 'No se puede recibir más de lo que salió: % kg despachados de %.',
            round(v_neto, 2), coalesce(v_nombre, 'este material');
        end if;
      end if;

      v_norm := v_norm || jsonb_build_array(jsonb_build_object(
        'id', v_lid, 'peso_bruto', v_bruto, 'tara', v_tara, 'peso_recibido', v_recibido));
      if v_bruto <> v_l.peso_bruto or v_tara <> v_l.tara
         or v_recibido is distinct from v_l.peso_recibido then
        v_cambian := v_cambian || v_lid;
      end if;
    end loop;
  end if;

  if array_length(v_cambian, 1) is not null then
    -- ---- Toma física abierta en origen o destino ----------------------------
    for v_l in
      select * from public.detalle_traslado where traslado_id = p_traslado_id and id = any(v_cambian)
    loop
      if v_l.producto_id is not null then
        if public.hay_toma_fisica_abierta(v_t.almacen_origen_id, v_l.producto_id)
           or public.hay_toma_fisica_abierta(v_t.almacen_destino_id, v_l.producto_id) then
          raise exception '%', c_msg_toma;
        end if;
      else
        v_hay_prod := false;
        for v_comp in
          select producto_id from public.detalle_traslado_composicion
           where detalle_traslado_id = v_l.id and producto_id is not null
        loop
          v_hay_prod := true;
          if public.hay_toma_fisica_abierta(v_t.almacen_origen_id, v_comp.producto_id, v_l.lote_id)
             or public.hay_toma_fisica_abierta(v_t.almacen_destino_id, v_comp.producto_id, v_l.lote_id) then
            raise exception '%', c_msg_toma;
          end if;
        end loop;
        if not v_hay_prod
           and (public.hay_toma_fisica_abierta_lote(v_t.almacen_origen_id, v_l.lote_id)
                or public.hay_toma_fisica_abierta_lote(v_t.almacen_destino_id, v_l.lote_id)) then
          raise exception '%', c_msg_toma;
        end if;
      end if;
    end loop;

    -- ---- Bloqueo de almacenes (orden fijo: sin deadlocks) -------------------
    v_almacenes := array[v_t.almacen_origen_id, v_t.almacen_destino_id];
    perform 1 from public.almacenes where id = any(v_almacenes) order by id for update;

    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_antes
      from public.stock_claves_traslado(p_traslado_id) x;

    -- ---- Escritura: líneas y reescalado del snapshot de composición ----------
    for v_n in
      select * from jsonb_to_recordset(v_norm)
        as n(id uuid, peso_bruto numeric, tara numeric, peso_recibido numeric)
       where id = any(v_cambian)
    loop
      select * into v_l from public.detalle_traslado where id = v_n.id;

      if v_l.lote_id is not null and round(v_n.peso_bruto - v_n.tara, 4) <> round(v_l.peso_neto, 4) then
        select coalesce(sum(peso_kg), 0) into v_suma_comp_ant
          from public.detalle_traslado_composicion where detalle_traslado_id = v_l.id;
        v_factor := (v_n.peso_bruto - v_n.tara) / v_l.peso_neto;

        update public.detalle_traslado_composicion
           set peso_kg = round(peso_kg * v_factor, 4)
         where detalle_traslado_id = v_l.id;

        if abs(v_suma_comp_ant - v_l.peso_neto) < 0.0001 then
          select round(v_n.peso_bruto - v_n.tara, 4) - coalesce(sum(peso_kg), 0) into v_resto
            from public.detalle_traslado_composicion where detalle_traslado_id = v_l.id;
          if abs(v_resto) >= 0.00005 then
            update public.detalle_traslado_composicion
               set peso_kg = peso_kg + v_resto
             where id = (
               select id from public.detalle_traslado_composicion
                where detalle_traslado_id = v_l.id
                order by peso_kg desc, id limit 1);
          end if;
        end if;
      end if;

      update public.detalle_traslado
         set peso_bruto = v_n.peso_bruto, tara = v_n.tara, peso_recibido = v_n.peso_recibido
       where id = v_n.id;
    end loop;
  end if;

  if p_set_observaciones then
    update public.tickets_traslado
       set observaciones = nullif(btrim(coalesce(p_observaciones, '')), '')
     where id = p_traslado_id;
  end if;

  -- ---- Stock DESPUÉS y verificación de negativos ------------------------------
  if array_length(v_cambian, 1) is not null then
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_despues
      from public.stock_claves_traslado(p_traslado_id) x;

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

  return jsonb_build_object('stock', v_stock_cambios);
end;
$function$;

-- Seguridad: estas funciones solo las llama el backend (service_role). Sin esto, la clave anon podria ejecutarlas por /rest/v1/rpc.
do $$ declare r record; begin for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('editar_traslado_pesos','stock_claves_traslado','hay_toma_fisica_abierta_lote') loop execute format('revoke execute on function %s from public, anon, authenticated', r.f); end loop; end $$;

commit;
