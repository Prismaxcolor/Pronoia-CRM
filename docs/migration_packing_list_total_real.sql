-- =============================================================================
-- Packing list: total real cobrado de la exportación (beneficio real)
-- =============================================================================
-- Requiere: migration_packing_list_lote_fotos.sql (y las anteriores del packing list).
-- Idempotente, una transacción. NO aplicada todavía.
-- Rollback: docs/migration_packing_list_total_real_ROLLBACK.sql.
--
-- Qué hace:
--   1. packing_lists.total_real_usd numeric(14,2) NULL, check >= 0: total realmente cobrado de la exportación (USD).
--      Dato INTERNO (solo con facturacion:ver; nunca en los PDF). Es el "beneficio real" principal; el valor real
--      por lote (valor_real_kg_usd dentro de `proyeccion`) se conserva como comparación por lote.
--   2. guardar_packing_list (misma firma, search_path fijo, control de versión PL409, preservación de almacén y
--      fotos): idéntica a la de migration_packing_list_lote_fotos.sql salvo que también guarda total_real_usd.
--      Clave `total_real_usd` ausente en p_cabecera = conserva lo guardado; null = lo borra; valor = lo reemplaza.
-- Despliegue: backend nuevo sin esta migración => leer funciona igual (sin el total); guardar CON total real
-- responde 409 «no habilitado».
-- =============================================================================

begin;

alter table public.packing_lists
  add column if not exists total_real_usd numeric(14,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'packing_lists_total_real_usd_check' and conrelid = 'public.packing_lists'::regclass) then
    alter table public.packing_lists
      add constraint packing_lists_total_real_usd_check check (total_real_usd is null or total_real_usd >= 0);
  end if;
end $$;

create or replace function public.guardar_packing_list(
  p_id               uuid,
  p_cabecera         jsonb,
  p_items            jsonb,
  p_usuario          uuid,
  p_version_esperada integer default null
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_id       uuid;
  v_version  integer;
  v_cliente  uuid;
  v_total    numeric(14,2);
  -- Almacén y fotos que tenían las paletas antes de reemplazar los ítems (por número de paleta).
  v_previos  jsonb := '[]'::jsonb;
begin
  if p_cabecera is null or jsonb_typeof(p_cabecera) <> 'object' then
    raise exception 'Faltan los datos del packing list.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'La lista de paletas es inválida.';
  end if;
  if p_cabecera ? 'proyeccion' and jsonb_typeof(p_cabecera->'proyeccion') <> 'array' then
    raise exception 'La proyección de exportación es inválida.';
  end if;
  -- Cliente internacional: clave ausente = conservar; null = desvincular; valor = debe ser internacional.
  if p_cabecera ? 'cliente_id' then
    v_cliente := nullif(p_cabecera->>'cliente_id', '')::uuid;
    if v_cliente is not null and not exists (
      select 1 from public.clientes c where c.id = v_cliente and c.tipo_venta = 'internacional'
    ) then
      raise exception 'El cliente elegido no es un cliente internacional.';
    end if;
  end if;
  -- Total real cobrado de la exportación (USD): clave ausente = conservar; null = borrar; valor = >= 0.
  if p_cabecera ? 'total_real_usd' then
    v_total := nullif(p_cabecera->>'total_real_usd', '')::numeric;
    if v_total is not null and v_total < 0 then
      raise exception 'El total real cobrado no puede ser negativo.';
    end if;
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'Un packing list admite como máximo 500 paletas.';
  end if;
  -- Fotos: solo rutas del bucket privado generadas por el sistema, máximo 5 por paleta.
  if exists (
    select 1
      from jsonb_array_elements(p_items) as i(item),
           jsonb_array_elements_text(case when jsonb_typeof(i.item->'fotos') = 'array' then i.item->'fotos' else '[]'::jsonb end) as f(ruta)
     where f.ruta !~ '^pl/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
  ) then
    raise exception 'Hay una foto con una ruta inválida.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) as i(item)
     where jsonb_typeof(i.item->'fotos') = 'array' and jsonb_array_length(i.item->'fotos') > 5
  ) then
    raise exception 'Una paleta admite como máximo 5 fotos.';
  end if;

  if p_id is null then
    insert into public.packing_lists (
      contenedor, fecha, tipo_embalaje, es_pcb, descripcion_es, descripcion_en,
      observaciones_es, observaciones_en, referencia_tipo, referencia_id, creado_por, proyeccion, cliente_id, total_real_usd
    ) values (
      p_cabecera->>'contenedor',
      coalesce(nullif(p_cabecera->>'fecha', '')::date, current_date),
      coalesce(nullif(p_cabecera->>'tipo_embalaje', ''), 'big_bag'),
      coalesce((p_cabecera->>'es_pcb')::boolean, true),
      nullif(btrim(p_cabecera->>'descripcion_es'), ''),
      nullif(btrim(p_cabecera->>'descripcion_en'), ''),
      nullif(btrim(p_cabecera->>'observaciones_es'), ''),
      nullif(btrim(p_cabecera->>'observaciones_en'), ''),
      nullif(p_cabecera->>'referencia_tipo', ''),
      nullif(p_cabecera->>'referencia_id', '')::uuid,
      p_usuario,
      coalesce(p_cabecera->'proyeccion', '[]'::jsonb),
      v_cliente,
      v_total
    ) returning id, version into v_id, v_version;
  else
    if p_version_esperada is null then
      raise exception 'Falta la versión del packing list que estás editando.';
    end if;
    -- El lock serializa dos guardados simultáneos: el segundo ve la versión ya incrementada.
    select id, version into v_id, v_version from public.packing_lists where id = p_id for update;
    if v_id is null then
      raise exception 'Packing list no encontrado.';
    end if;
    if v_version <> p_version_esperada then
      raise exception 'Otra persona modificó este packing list; recarga.' using errcode = 'PL409';
    end if;
    update public.packing_lists set
      contenedor       = p_cabecera->>'contenedor',
      fecha            = coalesce(nullif(p_cabecera->>'fecha', '')::date, fecha),
      tipo_embalaje    = coalesce(nullif(p_cabecera->>'tipo_embalaje', ''), tipo_embalaje),
      es_pcb           = coalesce((p_cabecera->>'es_pcb')::boolean, es_pcb),
      descripcion_es   = nullif(btrim(p_cabecera->>'descripcion_es'), ''),
      descripcion_en   = nullif(btrim(p_cabecera->>'descripcion_en'), ''),
      observaciones_es = nullif(btrim(p_cabecera->>'observaciones_es'), ''),
      observaciones_en = nullif(btrim(p_cabecera->>'observaciones_en'), ''),
      referencia_tipo  = nullif(p_cabecera->>'referencia_tipo', ''),
      referencia_id    = nullif(p_cabecera->>'referencia_id', '')::uuid,
      -- Ausente = conservar (quien no ve valores no la envía); presente = reemplazar.
      proyeccion       = case when p_cabecera ? 'proyeccion' then p_cabecera->'proyeccion' else proyeccion end,
      cliente_id       = case when p_cabecera ? 'cliente_id' then v_cliente else cliente_id end,
      total_real_usd   = case when p_cabecera ? 'total_real_usd' then v_total else total_real_usd end,
      version          = version + 1,
      updated_at       = now()
    where id = v_id
    returning version into v_version;
    select coalesce(jsonb_agg(jsonb_build_object(
             'numero', numero, 'numero_paleta', numero_paleta, 'lote', lote, 'almacen_id', almacen_id, 'fotos', to_jsonb(fotos))), '[]'::jsonb)
      into v_previos
      from public.packing_list_items where packing_list_id = v_id;
    delete from public.packing_list_items where packing_list_id = v_id;
  end if;

  insert into public.packing_list_items (
    packing_list_id, orden, numero, numero_paleta, lote, color, peso_bruto, peso_paleta, almacen_id, fotos
  )
  select
    v_id,
    e.ord::integer,
    (e.item->>'numero')::integer,
    nullif(e.item->>'numero_paleta', '')::integer,
    nullif(btrim(e.item->>'lote'), ''),
    nullif(btrim(e.item->>'color'), ''),
    (e.item->>'peso_bruto')::numeric,
    coalesce(nullif(e.item->>'peso_paleta', '')::numeric, 0),
    -- Clave ausente = conservar lo de la paleta anterior emparejada (ver cabecera); presente (aun null) = reemplazar.
    case
      when e.item ? 'almacen_id' then nullif(e.item->>'almacen_id', '')::uuid
      else nullif(m.prev->>'almacen_id', '')::uuid
    end,
    case
      when e.item ? 'fotos' and jsonb_typeof(e.item->'fotos') = 'array'
        then array(select jsonb_array_elements_text(e.item->'fotos'))
      else coalesce(array(select jsonb_array_elements_text(m.prev->'fotos')), '{}'::text[])
    end
  from jsonb_array_elements(p_items) with ordinality as e(item, ord)
  left join lateral (
    select p.prev
      from jsonb_array_elements(v_previos) as p(prev)
     where case
             when nullif(e.item->>'numero_paleta', '') is not null
               then (p.prev->>'numero_paleta') = (e.item->>'numero_paleta')
                and coalesce(p.prev->>'lote', '') = coalesce(nullif(btrim(e.item->>'lote'), ''), '')
             else (p.prev->>'numero_paleta') is null
              and (p.prev->>'numero') = (e.item->>'numero')
           end
     order by ((p.prev->>'numero') = (e.item->>'numero')) desc, (p.prev->>'numero')::integer
     limit 1
  ) as m on true;

  return jsonb_build_object('id', v_id, 'version', v_version);
end;
$function$;

revoke execute on function public.guardar_packing_list(uuid, jsonb, jsonb, uuid, integer) from public, anon, authenticated;
grant execute on function public.guardar_packing_list(uuid, jsonb, jsonb, uuid, integer) to service_role;

commit;

notify pgrst, 'reload schema';
