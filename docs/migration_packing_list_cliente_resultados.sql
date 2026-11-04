-- =============================================================================
-- Packing list: cliente internacional vinculado + resultados de la exportación
-- =============================================================================
-- Requiere: migration_packing_list.sql, migration_packing_list_version.sql,
--           migration_packing_list_proyeccion.sql y migration_clientes_tipo_venta.sql.
-- Idempotente, una transacción. NO aplicada todavía.
-- Rollback: docs/migration_packing_list_cliente_resultados_ROLLBACK.sql.
--
-- Qué hace:
--   1. packing_lists.cliente_id (uuid, NULL, FK a clientes ON DELETE SET NULL): cliente internacional
--      al que va la exportación. Los packing lists anteriores quedan sin cliente.
--   2. guardar_packing_list (misma firma de 5 parámetros, search_path fijo): lee p_cabecera->'cliente_id'.
--      Clave ausente = conserva el vínculo (cola offline anterior al cambio); null = desvincula; con valor,
--      exige que el cliente sea tipo_venta = 'internacional' (error legible si no).
--
-- Los VALORES REALES por lote NO necesitan columna ni cambio de función: viajan dentro de la columna
-- jsonb ya existente `proyeccion`, como "valor_real_kg_usd" junto a "valor_kg_usd" en cada línea
-- ([{ "lote": "1", "valor_kg_usd": 2.5, "valor_real_kg_usd": 2.7 }, ...]). Líneas antiguas siguen válidas.
-- Siguen protegidos igual que la proyección: solo se leen/escriben con facturacion:ver.
--
-- Seguridad: packing_lists ya tiene RLS sin políticas y REVOKE a anon/authenticated; la columna nueva
-- hereda eso. La función solo se concede a service_role.
-- Despliegue: backend nuevo sin esta migración => detalle y guardado sin cliente siguen funcionando;
-- vincular un cliente responde 409 «no habilitado» (no se pierde en silencio).
-- =============================================================================

begin;

alter table public.packing_lists
  add column if not exists cliente_id uuid references public.clientes(id) on delete set null;

create index if not exists idx_packing_lists_cliente on public.packing_lists (cliente_id)
  where cliente_id is not null;

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
  v_id      uuid;
  v_version integer;
  v_cliente uuid;
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

commit;

-- Que PostgREST vea de inmediato las columnas y la función nuevas (sin esperar a su recarga automática).
notify pgrst, 'reload schema';
