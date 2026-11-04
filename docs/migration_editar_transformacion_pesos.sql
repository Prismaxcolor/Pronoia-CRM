-- =============================================================================
-- Editar los pesos de una transformación (entrada y salidas) con llave de edición
-- =============================================================================
-- MIGRACIÓN ADITIVA E IDEMPOTENTE (create or replace). No toca tablas ni datos
-- existentes y no modifica ninguna función actual. Todo en una transacción.
--
-- ROLLBACK (el backend queda tolerante: sin la función, editar pesos responde
-- 409 "aún no está habilitado" y fecha/notas siguen funcionando):
--   drop function if exists public.editar_transformacion_pesos(uuid, numeric, numeric, jsonb, date, text, boolean);
--   drop function if exists public.stock_claves_transformacion(uuid);
--   drop function if exists public.hay_toma_fisica_abierta_lote(uuid, uuid);
--   (hay_toma_fisica_abierta_lote también la crea migration_editar_traslado_pesos.sql;
--    no la borres si esa migración ya está aplicada.)
--
-- Qué se calcula solo y qué hace esta función (mapa de dependencias):
--   * El stock NO se guarda: stock_almacen / stock_lote_* lo derivan en vivo de
--     transformacion_entrada_detalle.peso_kg (lo que sale del stock) y de
--     transformacion_salida_detalle.peso_neto (lo que entra). peso_neto de
--     transformaciones y de las salidas es columna generada (bruto - tara).
--   * transformacion_entrada_detalle.peso_kg es un SNAPSHOT (ferroso: 1 fila =
--     neto; PCB: reparto proporcional a la composición del lote al crear). Al
--     cambiar el neto de entrada se reescala conservando proporciones y el
--     residuo de redondeo (4 decimales) se absorbe en la fila mayor para que
--     el detalle siga sumando exactamente el neto. Sin esto el stock no se
--     movería (el detalle de entrada es lo que lo descuenta).
--   * Merma, ganancia/valoración (costo_unitario y precio_unitario son $/kg),
--     reportes de inventario y composición de lotes se derivan en vivo de los
--     pesos: se corrigen solos. factura_compra_id es solo una referencia (el
--     total de la factura sale de los tickets de compra, no de la
--     transformación): NO se anula ni toca ninguna factura.
--
-- Reglas de seguridad (todas dentro de la misma transacción: si una falla, no
-- se guarda nada y la llave se libera en el backend):
--   1. Solo categorías pcb / ferroso_no_ferroso. Salidas solo si está completa.
--   2. neto de entrada > 0; neto de cada salida > 0 (a 2 decimales);
--      suma de salidas <= neto de entrada + 0.01 kg (igual que completar_*).
--   3. Toma física abierta sobre producto/almacén/lote afectado => se rechaza
--      (mismo criterio que editar_ticket_pesaje). Las cerradas no se tocan.
--   4. Stock: se calcula con las mismas funciones del sistema ANTES y DESPUÉS
--      sobre todas las claves afectadas (producto x almacén, lote x almacén x
--      producto y total del lote x almacén). Si alguna queda < 0 y empeora
--      respecto a antes => excepción. Un stock que ya era negativo y no
--      empeora no bloquea (la edición no es la causa).
--   5. Se bloquean (FOR UPDATE) la transformación y los almacenes implicados.
--
-- Devuelve jsonb: { "facturaCompraId": uuid|null,
--                   "stock": [ { "etiqueta": text, "antes": n, "despues": n } ] }
-- con solo las claves de stock que cambiaron (para auditoría y avisos).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Toma física abierta que cubre un lote en un almacén. Se usa solo cuando el
-- lote no tiene productos atribuidos (composición sin desglose), caso en que
-- hay_toma_fisica_abierta (que exige producto) no puede evaluarlo. Conservador:
-- cualquier toma abierta del almacén sin alcance de lotes, o que incluya el lote.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Stock de todas las claves que una transformación puede mover. Usa las
-- funciones oficiales de stock, de modo que "antes/después" es exactamente lo
-- que ve el inventario.
-- ---------------------------------------------------------------------------
create or replace function public.stock_claves_transformacion(p_transformacion_id uuid)
returns table(
  clave text, etiqueta text, stock numeric,
  tipo text, almacen_id uuid, lote_id uuid, producto_id uuid
)
language sql
stable
set search_path = public
as $function$
  with t as (
    select id, almacen_id, lote_origen_id
    from public.transformaciones where id = p_transformacion_id
  ),
  ent as (
    select e.producto_id
    from public.transformacion_entrada_detalle e
    where e.transformacion_id = p_transformacion_id and e.producto_id is not null
  ),
  sal as (
    select s.producto_id, s.lote_destino_id, coalesce(s.almacen_id, t.almacen_id) as almacen_id
    from public.transformacion_salida_detalle s cross join t
    where s.transformacion_id = p_transformacion_id
  ),
  -- (almacén, producto) cuyo stock puede cambiar
  pa as (
    select t.almacen_id, ent.producto_id from t cross join ent where t.almacen_id is not null
    union
    select sal.almacen_id, sal.producto_id
      from sal where sal.producto_id is not null and sal.almacen_id is not null
    union
    -- salida a lote sin producto: hereda la composición de la entrada
    select sal.almacen_id, ent.producto_id from sal cross join ent
      where sal.lote_destino_id is not null and sal.producto_id is null and sal.almacen_id is not null
  ),
  -- (lote, almacén) cuyo stock puede cambiar
  la as (
    select t.lote_origen_id as lote_id, t.almacen_id
      from t where t.lote_origen_id is not null and t.almacen_id is not null
    union
    select sal.lote_destino_id, sal.almacen_id
      from sal where sal.lote_destino_id is not null and sal.almacen_id is not null
  ),
  stock_pa as (
    select a.almacen_id, s.producto_id, s.stock
    from (select distinct almacen_id from pa) a
    cross join lateral public.stock_almacen(a.almacen_id) s
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

-- ---------------------------------------------------------------------------
-- Edición atómica de pesos (+ fecha y notas) de una transformación.
-- ---------------------------------------------------------------------------
create or replace function public.editar_transformacion_pesos(
  p_transformacion_id uuid,
  p_peso_bruto        numeric default null,
  p_tara              numeric default null,
  p_salidas           jsonb   default null,  -- [{ "id": uuid, "peso_bruto": n?, "tara": n? }]
  p_fecha             date    default null,
  p_notas             text    default null,
  p_set_notas         boolean default false
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
  v_pesos_cambian := v_neto_cambia or array_length(v_cambian, 1) is not null;

  -- ---- Balance: suma de TODAS las salidas (editadas y no) vs entrada --------
  select coalesce(sum(case when n.id is not null then n.peso_bruto - n.tara else s.peso_neto end), 0)
    into v_suma_salidas
    from public.transformacion_salida_detalle s
    left join jsonb_to_recordset(v_norm) as n(id uuid, peso_bruto numeric, tara numeric) on n.id = s.id
   where s.transformacion_id = p_transformacion_id;
  if v_suma_salidas > v_neto_nuevo + c_tol_balance then
    raise exception 'Las salidas suman % kg y superan el peso neto de entrada (% kg).',
      round(v_suma_salidas, 2), round(v_neto_nuevo, 2);
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

-- Seguridad: estas funciones solo las llama el backend (service_role). Sin esto, la clave anon podria ejecutarlas por /rest/v1/rpc.
do $$ declare r record; begin for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('editar_transformacion_pesos','stock_claves_transformacion','hay_toma_fisica_abierta_lote') loop execute format('revoke execute on function %s from public, anon, authenticated', r.f); end loop; end $$;

commit;
