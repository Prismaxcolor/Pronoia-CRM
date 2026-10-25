-- =============================================================================
-- Rollback de migration_packing_list_proyeccion.sql
-- =============================================================================
-- Restaura guardar_packing_list a la versión de migration_packing_list_version.sql y elimina la
-- columna proyeccion (SE PIERDEN las valoraciones guardadas). El backend actual sigue funcionando
-- sin la columna (el detalle carga sin proyección).
-- =============================================================================

begin;

create or replace function public.guardar_packing_list(
  p_id               uuid,
  p_cabecera         jsonb,
  p_items            jsonb,
  p_usuario          uuid,
  p_version_esperada integer default null
) returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_id      uuid;
  v_version integer;
begin
  if p_cabecera is null or jsonb_typeof(p_cabecera) <> 'object' then
    raise exception 'Faltan los datos del packing list.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'La lista de paletas es inválida.';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'Un packing list admite como máximo 500 paletas.';
  end if;

  if p_id is null then
    insert into public.packing_lists (
      contenedor, fecha, tipo_embalaje, es_pcb, descripcion_es, descripcion_en,
      observaciones_es, observaciones_en, referencia_tipo, referencia_id, creado_por
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
      p_usuario
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
      version          = version + 1,
      updated_at       = now()
    where id = v_id
    returning version into v_version;
    delete from public.packing_list_items where packing_list_id = v_id;
  end if;

  insert into public.packing_list_items (
    packing_list_id, orden, numero, numero_paleta, lote, color, peso_bruto, peso_paleta
  )
  select
    v_id,
    e.ord::integer,
    (e.item->>'numero')::integer,
    nullif(e.item->>'numero_paleta', '')::integer,
    nullif(btrim(e.item->>'lote'), ''),
    nullif(btrim(e.item->>'color'), ''),
    (e.item->>'peso_bruto')::numeric,
    coalesce(nullif(e.item->>'peso_paleta', '')::numeric, 0)
  from jsonb_array_elements(p_items) with ordinality as e(item, ord);

  return jsonb_build_object('id', v_id, 'version', v_version);
end;
$function$;

revoke execute on function public.guardar_packing_list(uuid, jsonb, jsonb, uuid, integer) from public, anon, authenticated;
grant execute on function public.guardar_packing_list(uuid, jsonb, jsonb, uuid, integer) to service_role;

alter table public.packing_lists drop constraint if exists packing_lists_proyeccion_es_arreglo;
alter table public.packing_lists drop column if exists proyeccion;

commit;
