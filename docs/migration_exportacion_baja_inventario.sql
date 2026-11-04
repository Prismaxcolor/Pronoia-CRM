-- =============================================================================
-- Exportación: baja de inventario al asignar el packing list a un cliente.
--
-- Cuando un packing list pasa a ser una exportación (se le asigna cliente internacional) el material que
-- contiene sale del inventario como si fuese una venta: un ajuste NEGATIVO por lote y almacén, con
-- motivo 'exportacion' y el packing list de origen. stock_lote_por_almacen() ya suma ajustes_inventario
-- por lote y almacén, así que NO se toca ninguna función de stock.
--
-- Cambios (aditivos, idempotentes, una transacción):
--   1. ajustes_inventario.packing_list_id (nullable, ON DELETE SET NULL) + índice parcial.
--   2. Función dar_baja_exportacion(p_packing_list_id, p_usuario_id) -> jsonb
--      {"ya_registrada": bool, "lotes": [{"lote", "almacen_id", "kg", "exceso_kg"}], "sin_lote": [nombres]}
--      - Suma los kg netos de los ítems por lote y almacén. El ítem guarda "1" para el lote "LOTE 1": se cruza
--        normalizando ambos lados igual que valorLotePacking del backend.
--      - Ítems con almacén (lo normal: lo elige el editor): se descuenta de ESE almacén.
--      - Ítems sin almacén: se descuenta de los almacenes con stock, del que más tiene al que menos.
--      - Si el stock no alcanza, el material igual sale (salió físicamente): el stock queda negativo y se
--        informa en exceso_kg.
--      - Idempotente: si el packing list ya tiene bajas, no hace nada (ya_registrada = true).
--      - Los ítems sin lote o con un nombre de lote que no existe no se descuentan (sin_lote).
--
-- Backend: backend/src/services/exportacion-baja-inventario.ts (se llama al guardar el packing list con cliente).
-- ROLLBACK: docs/migration_exportacion_baja_inventario_ROLLBACK.sql
-- =============================================================================

begin;

alter table public.ajustes_inventario
  add column if not exists packing_list_id uuid references public.packing_lists(id) on delete set null;

create index if not exists idx_ajustes_inventario_packing_list
  on public.ajustes_inventario (packing_list_id) where packing_list_id is not null;

create or replace function public.dar_baja_exportacion(p_packing_list_id uuid, p_usuario_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_grupo     record;
  v_alm       record;
  v_stock     numeric;
  v_restante  numeric;
  v_tomar     numeric;
  v_exceso    numeric;
  v_principal uuid;
  v_lotes     jsonb := '[]'::jsonb;
  v_sin_lote  jsonb := '[]'::jsonb;
begin
  perform 1 from public.packing_lists where id = p_packing_list_id for update;
  if not found then
    raise exception 'Packing list no encontrado.';
  end if;

  if exists (select 1 from public.ajustes_inventario where packing_list_id = p_packing_list_id) then
    return jsonb_build_object('ya_registrada', true, 'lotes', '[]'::jsonb, 'sin_lote', '[]'::jsonb);
  end if;

  -- El ítem guarda "1" para el lote "LOTE 1" (valorLotePacking en el backend): se normaliza igual a ambos lados.
  select coalesce(jsonb_agg(distinct btrim(i.lote)), '[]'::jsonb) into v_sin_lote
    from public.packing_list_items i
   where i.packing_list_id = p_packing_list_id
     and btrim(coalesce(i.lote, '')) <> ''
     and not exists (
       select 1 from public.lotes l
        where regexp_replace(lower(btrim(l.nombre)), '^lote\s*(\d+)$', '\1') = regexp_replace(lower(btrim(i.lote)), '^lote\s*(\d+)$', '\1')
     );

  -- Primero lo que el packing asigna a un almacén concreto; después lo que no tiene almacén.
  for v_grupo in
    select l.id as lote_id, l.nombre, i.almacen_id, sum(i.peso_neto) as kg
      from public.packing_list_items i
      join public.lotes l
        on regexp_replace(lower(btrim(l.nombre)), '^lote\s*(\d+)$', '\1') = regexp_replace(lower(btrim(i.lote)), '^lote\s*(\d+)$', '\1')
     where i.packing_list_id = p_packing_list_id
       and btrim(coalesce(i.lote, '')) <> ''
     group by l.id, l.nombre, i.almacen_id
     having sum(i.peso_neto) > 0
     order by (i.almacen_id is null), l.id, i.almacen_id
  loop
    -- Serializa contra transformaciones y otras bajas sobre el mismo lote.
    perform 1 from public.lotes where id = v_grupo.lote_id for update;
    v_exceso := 0;

    if v_grupo.almacen_id is not null then
      select coalesce(sum(s.stock), 0) into v_stock
        from public.stock_lote_por_almacen(v_grupo.lote_id) s where s.almacen_id = v_grupo.almacen_id;
      insert into public.ajustes_inventario
        (toma_fisica_id, producto_id, lote_id, almacen_id, stock_teorico, stock_real, registrado_por, motivo, packing_list_id)
      values (null, null, v_grupo.lote_id, v_grupo.almacen_id, v_stock, v_stock - v_grupo.kg, p_usuario_id, 'exportacion', p_packing_list_id);
      v_exceso := greatest(v_grupo.kg - greatest(v_stock, 0), 0);
    else
      v_restante := v_grupo.kg;
      v_principal := null;
      for v_alm in
        select s.almacen_id, s.stock from public.stock_lote_por_almacen(v_grupo.lote_id) s
         where s.almacen_id is not null order by s.stock desc, s.almacen_id
      loop
        if v_principal is null then
          v_principal := v_alm.almacen_id;
        end if;
        exit when v_restante <= 0.005;
        continue when v_alm.stock <= 0.005;
        v_tomar := least(v_alm.stock, v_restante);
        insert into public.ajustes_inventario
          (toma_fisica_id, producto_id, lote_id, almacen_id, stock_teorico, stock_real, registrado_por, motivo, packing_list_id)
        values (null, null, v_grupo.lote_id, v_alm.almacen_id, v_alm.stock, v_alm.stock - v_tomar, p_usuario_id, 'exportacion', p_packing_list_id);
        v_restante := v_restante - v_tomar;
      end loop;

      if v_restante > 0.005 then
        -- Sin stock suficiente: el sobrante sale del almacén con más stock (o del primer almacén activo si el lote nunca tuvo).
        if v_principal is null then
          select a.id into v_principal from public.almacenes a where a.activo order by a.nombre limit 1;
        end if;
        if v_principal is null then
          raise exception 'No hay almacenes activos para descontar el lote %.', v_grupo.nombre;
        end if;
        select coalesce(sum(s.stock), 0) into v_stock
          from public.stock_lote_por_almacen(v_grupo.lote_id) s where s.almacen_id = v_principal;
        insert into public.ajustes_inventario
          (toma_fisica_id, producto_id, lote_id, almacen_id, stock_teorico, stock_real, registrado_por, motivo, packing_list_id)
        values (null, null, v_grupo.lote_id, v_principal, v_stock, v_stock - v_restante, p_usuario_id, 'exportacion', p_packing_list_id);
        v_exceso := v_restante;
      end if;
    end if;

    v_lotes := v_lotes || jsonb_build_object('lote', v_grupo.nombre, 'almacen_id', v_grupo.almacen_id, 'kg', v_grupo.kg, 'exceso_kg', v_exceso);
  end loop;

  return jsonb_build_object('ya_registrada', false, 'lotes', v_lotes, 'sin_lote', v_sin_lote);
end;
$function$;

revoke execute on function public.dar_baja_exportacion(uuid, uuid) from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
