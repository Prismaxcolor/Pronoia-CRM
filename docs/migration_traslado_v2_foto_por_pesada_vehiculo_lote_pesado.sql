-- =============================================================================
-- Ajuste sobre las migraciones de traslado de esta sesión, a pedido de Julio
-- tras ver el formulario desplegado:
--
--   1. Vehículo también en Traslado (antes solo compra/venta) — nuevo
--      catálogo `vehiculos` (seleccionable, con predeterminados guardados),
--      no texto libre suelto.
--   2. Foto POR CADA PESADA (material o lote), no una sola foto general del
--      traslado — mismo patrón que ya usa el pesaje de compra/venta
--      (detalle_tickets_pesaje.fotos). Se revierte el uso de
--      tickets_traslado.fotos en la creación: esa columna vuelve a ser
--      exclusiva de la evidencia de RECEPCIÓN (completar_traslado), como
--      era antes — si se llenaba también en la creación, completar_traslado
--      la sobrescribía y esas fotos se perdían.
--   3. El lote a trasladar se PESA de verdad (peso bruto + tara), no se
--      asume automáticamente el stock teórico (stock_lote_total) — más
--      preciso y consistente con que todo en el sistema se pesa.
--
-- CÓMO APLICAR: pegar en Supabase Studio → SQL Editor y ejecutar.
-- =============================================================================

create table if not exists public.vehiculos (
  id         uuid        primary key default gen_random_uuid(),
  nombre     text        not null,
  activo     boolean     not null default true,
  created_at timestamptz not null default now()
);
alter table public.vehiculos disable row level security;
create unique index if not exists idx_vehiculos_nombre on public.vehiculos (lower(nombre));

alter table public.tickets_traslado
  add column if not exists vehiculo text;

alter table public.detalle_traslado
  add column if not exists fotos text[] not null default '{}';

-- Cambia la firma otra vez (fotos pasan de nivel-traslado a nivel-línea,
-- se agrega vehículo, y los lotes ahora llevan peso propio) — DROP
-- explícito de la versión anterior para no dejar overloads ambiguos.
drop function if exists public.crear_traslado(uuid, uuid, text, jsonb, uuid, text[], uuid[]);

create or replace function public.crear_traslado(
  p_almacen_origen_id  uuid,
  p_almacen_destino_id uuid,
  p_observaciones      text,
  p_materiales         jsonb,
  p_pesado_por         uuid,
  p_lotes              jsonb DEFAULT '[]'::jsonb,
  p_vehiculo           text DEFAULT NULL::text
) returns uuid
language plpgsql
as $function$
declare
  v_id   uuid;
  v_item jsonb;
begin
  if p_almacen_origen_id = p_almacen_destino_id then
    raise exception 'El almacén de origen y destino no pueden ser el mismo.';
  end if;

  -- Bloquea el almacén de origen para que dos traslados concurrentes no
  -- pisen el mismo cálculo de stock a mitad de camino (no es una
  -- validación de cantidad disponible, es control de concurrencia).
  perform 1 from public.almacenes where id = p_almacen_origen_id for update;

  for v_item in select value from jsonb_array_elements(coalesce(p_materiales, '[]'::jsonb)) as elems(value)
  loop
    if public.hay_toma_fisica_abierta(p_almacen_origen_id, (v_item->>'producto_id')::uuid)
       or public.hay_toma_fisica_abierta(p_almacen_destino_id, (v_item->>'producto_id')::uuid) then
      raise exception 'Uno de los materiales tiene una toma física de inventario abierta en el origen o el destino. No se pueden registrar traslados hasta cerrarla.';
    end if;
    if not (v_item ? 'fotos') or jsonb_array_length(v_item->'fotos') = 0 then
      raise exception 'Cada material necesita al menos una foto.';
    end if;
  end loop;

  -- Lotes a trasladar: deben existir, estar activos, estar HOY en el
  -- almacén de origen, no tener ya otro traslado pendiente encima (evita
  -- que el mismo lote quede "prometido" a dos destinos a la vez), y traer
  -- su propia foto de pesaje.
  for v_item in select value from jsonb_array_elements(coalesce(p_lotes, '[]'::jsonb)) as elems(value)
  loop
    if not exists (
      select 1 from public.lotes
      where id = (v_item->>'lote_id')::uuid and almacen_id = p_almacen_origen_id and activo
    ) then
      raise exception 'Uno de los lotes seleccionados no está activo en el almacén de origen.';
    end if;
    if exists (
      select 1
      from public.detalle_traslado dt
      join public.tickets_traslado t on t.id = dt.traslado_id
      where dt.lote_id = (v_item->>'lote_id')::uuid and t.estado = 'pendiente'
    ) then
      raise exception 'Uno de los lotes seleccionados ya tiene un traslado pendiente.';
    end if;
    if not (v_item ? 'fotos') or jsonb_array_length(v_item->'fotos') = 0 then
      raise exception 'Cada lote necesita al menos una foto del pesaje.';
    end if;
  end loop;

  insert into public.tickets_traslado
    (almacen_origen_id, almacen_destino_id, observaciones, pesado_por, vehiculo)
  values (
    p_almacen_origen_id, p_almacen_destino_id, nullif(p_observaciones, ''), p_pesado_por,
    nullif(p_vehiculo, '')
  )
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_materiales, '[]'::jsonb)) as elems(value)
  loop
    insert into public.detalle_traslado
      (traslado_id, producto_id, subcategoria, peso_bruto, tara, fotos)
    values (
      v_id,
      (v_item->>'producto_id')::uuid,
      nullif(v_item->>'subcategoria', ''),
      (v_item->>'peso_bruto')::numeric,
      (v_item->>'tara')::numeric,
      coalesce((select array_agg(x) from jsonb_array_elements_text(v_item->'fotos') as x), '{}')
    );
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_lotes, '[]'::jsonb)) as elems(value)
  loop
    insert into public.detalle_traslado
      (traslado_id, lote_id, peso_bruto, tara, fotos)
    values (
      v_id,
      (v_item->>'lote_id')::uuid,
      (v_item->>'peso_bruto')::numeric,
      (v_item->>'tara')::numeric,
      coalesce((select array_agg(x) from jsonb_array_elements_text(v_item->'fotos') as x), '{}')
    );
  end loop;

  return v_id;
end;
$function$;
