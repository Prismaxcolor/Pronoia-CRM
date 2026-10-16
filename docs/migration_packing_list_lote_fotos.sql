-- =============================================================================
-- Packing list: lote de exportación con almacén, color predeterminado por lote y fotos por paleta
-- =============================================================================
-- Requiere: migration_packing_list.sql, migration_packing_list_version.sql,
--           migration_packing_list_proyeccion.sql y migration_packing_list_cliente_resultados.sql.
-- Idempotente, una transacción. NO aplicada todavía.
-- Rollback: docs/migration_packing_list_lote_fotos_ROLLBACK.sql.
-- Diseño: docs/DISENO_packing_list_lote_fotos_color.md.
--
-- Qué hace:
--   1. lotes.color_packing_list (text, NULL): color predeterminado del lote para el packing list. Es la CLAVE
--      del catálogo COLORES_LOTE (green, black, blue, ...). Se edita desde Inventario > Lotes > Editar lote.
--   2. packing_list_items.almacen_id (uuid, NULL, FK a almacenes ON DELETE SET NULL): almacén del que se trabaja
--      el lote. CONTROL INTERNO: nunca va en los PDF. Los ítems anteriores quedan sin almacén (el lote de texto
--      libre que ya tenían se conserva tal cual; no se migran datos).
--   3. packing_list_items.fotos (text[], NOT NULL, default '{}'): rutas de las fotos de control interno de la
--      paleta (máximo 5). Solo rutas del bucket privado 'packing-fotos' (pl/<uuid>.<jpg|png|webp>), nunca URLs.
--   4. Bucket PRIVADO 'packing-fotos' (límite de 6 MB = 6291456 bytes y solo image/jpeg, image/png y image/webp
--      a nivel de bucket; el backend valida además la firma real del archivo y que el tipo declarado coincida). storage.objects tiene RLS sin políticas para
--      anon/authenticated: solo el backend (service_role) sube y firma URLs temporales.
--   5. guardar_packing_list (misma firma de 5 parámetros, search_path fijo): además de lo anterior, guarda
--      almacen_id y fotos de cada ítem. Si el ítem NO trae esas claves (app anterior a este cambio, cola sin
--      conexión vieja, o un usuario sin permiso de inventario, a quien el backend no le envía esas claves)
--      conserva el almacén y las fotos que tenía la paleta, para que guardar no borre fotos.
--      EMPAREJAMIENTO de la paleta nueva con la anterior (la fila `numero` es solo la posición 1..n y cambia
--      al borrar o reordenar filas, por eso no es la clave principal):
--        a) si el ítem trae numero_paleta (no NULL): misma numero_paleta Y mismo lote (texto, '' si no tiene).
--           El numero_paleta reinicia en cada lote, así que solo no basta. Si hubiera varias coincidencias se
--           prefiere la de la misma posición `numero` y, si no, la de menor `numero`.
--        b) si numero_paleta es NULL: la paleta anterior sin numero_paleta y con la misma posición `numero`.
--      Sin coincidencia la paleta se trata como nueva (sin almacén ni fotos heredados). Las fotos que dejan de
--      estar en alguna paleta las borra del bucket el backend (best-effort), no esta función.
--
-- Seguridad: packing_lists / packing_list_items ya tienen RLS sin políticas y REVOKE a anon/authenticated; las
-- columnas nuevas heredan eso. La función solo se concede a service_role.
-- Despliegue: backend nuevo sin esta migración => el packing list se lee y guarda como antes (sin almacén ni
-- fotos); guardar con almacén o fotos responde 409 «no habilitado» (nada se pierde en silencio); el color del
-- lote responde 409 al editarlo y el selector de lotes sigue funcionando sin color.
-- =============================================================================

begin;

-- 1. Color predeterminado por lote ------------------------------------------------------------------------------
alter table public.lotes
  add column if not exists color_packing_list text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lotes_color_packing_list_check' and conrelid = 'public.lotes'::regclass) then
    alter table public.lotes
      add constraint lotes_color_packing_list_check
      check (color_packing_list is null or color_packing_list in
        ('green', 'black', 'blue', 'red', 'yellow', 'orange', 'purple', 'brown', 'white', 'gray'));
  end if;
end $$;

-- 2 y 3. Almacén y fotos por paleta -----------------------------------------------------------------------------
alter table public.packing_list_items
  add column if not exists almacen_id uuid references public.almacenes(id) on delete set null;
alter table public.packing_list_items
  add column if not exists fotos text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'packing_list_items_fotos_check' and conrelid = 'public.packing_list_items'::regclass) then
    alter table public.packing_list_items
      add constraint packing_list_items_fotos_check check (cardinality(fotos) <= 5);
  end if;
end $$;

create index if not exists idx_packing_list_items_almacen on public.packing_list_items (almacen_id)
  where almacen_id is not null;

-- 4. Bucket privado de fotos de control interno -----------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('packing-fotos', 'packing-fotos', false, 6291456, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 5. guardar_packing_list con almacén y fotos -------------------------------------------------------------------
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
      observaciones_es, observaciones_en, referencia_tipo, referencia_id, creado_por, proyeccion, cliente_id
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
      v_cliente
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

-- Que PostgREST vea de inmediato las columnas y la función nuevas (sin esperar a su recarga automática).
notify pgrst, 'reload schema';
