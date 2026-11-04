-- =============================================================================
-- Vaciar DESECHOS: botón que deja el producto "DESECHOS" (basura que se lleva
-- al vertedero) en 0 kg, con trazabilidad.
--
-- Cómo se registra: un AJUSTE de inventario por cada almacén con stock positivo
-- de ese producto (stock_teorico = kg que había, stock_real = 0, diferencia =
-- -kg, registrado_por = quien vació, created_at = cuándo). stock_almacen() ya
-- suma ajustes_inventario sin lote por almacén, así que NO se toca ninguna
-- función de stock.
--
-- Cambios (aditivos, idempotentes, una transacción):
--   1. ajustes_inventario.toma_fisica_id pasa a admitir NULL (un vaciado no
--      pertenece a ninguna toma física) y se agrega la columna motivo
--      ('vaciado_desechos'). CHECK: o hay toma física o hay motivo, para que
--      ningún ajuste quede sin origen. Los ajustes de tomas existentes no cambian.
--   2. Función vaciar_desechos(p_producto_id, p_usuario_id) -> jsonb
--      [{"almacen_id": ..., "kg": ...}, ...]. SOLO acepta el producto cuyo
--      nombre es DESECHOS (sin distinguir mayúsculas/espacios); cualquier otro
--      lanza excepción. Bloquea cada almacén (serializa contra traslados y
--      tomas físicas), se niega si hay una toma física abierta que incluya la
--      categoría del producto en ese almacén, y no hace nada si no hay stock.
--      Un stock negativo (error de datos) no se toca: solo se vacía lo positivo.
--
-- Backend: backend/src/services/vaciar-desechos-service.ts
--   POST /api/inventario/desechos/:productoId/vaciar (permiso toma_fisica:editar).
--
-- ROLLBACK (manual; antes, borrar o reasignar los ajustes con toma_fisica_id NULL):
--   begin;
--     drop function if exists public.vaciar_desechos(uuid, uuid);
--     alter table public.ajustes_inventario drop constraint if exists ajustes_inventario_origen_check;
--     alter table public.ajustes_inventario drop column if exists motivo;
--     alter table public.ajustes_inventario alter column toma_fisica_id set not null;
--   commit;
-- =============================================================================

begin;

alter table public.ajustes_inventario alter column toma_fisica_id drop not null;
alter table public.ajustes_inventario add column if not exists motivo text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ajustes_inventario_origen_check' and conrelid = 'public.ajustes_inventario'::regclass
  ) then
    alter table public.ajustes_inventario
      add constraint ajustes_inventario_origen_check check (toma_fisica_id is not null or motivo is not null);
  end if;
end $$;

create or replace function public.vaciar_desechos(p_producto_id uuid, p_usuario_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_nombre    text;
  v_categoria uuid;
  v_alm       record;
  v_stock     numeric;
  v_resultado jsonb := '[]'::jsonb;
begin
  select p.nombre, p.tipo_material_id into v_nombre, v_categoria
    from public.productos p where p.id = p_producto_id;

  if v_nombre is null then
    raise exception 'Producto no encontrado.';
  end if;
  if lower(btrim(v_nombre)) <> 'desechos' then
    raise exception 'Solo el producto DESECHOS se puede vaciar.';
  end if;

  for v_alm in select a.id from public.almacenes a where a.activo order by a.id
  loop
    -- Mismo orden de bloqueo que culminar_toma_fisica_inventario.
    perform 1 from public.almacenes where id = v_alm.id for update;

    if v_categoria is not null and exists (
      select 1 from public.tomas_fisicas_inventario t
      where t.almacen_id = v_alm.id and t.estado = 'abierta' and v_categoria = any(t.categorias)
    ) then
      raise exception 'Hay una toma física abierta que incluye la categoría de DESECHOS en un almacén. Culmínala o cancélala primero.';
    end if;

    select coalesce(sum(s.stock), 0) into v_stock
      from public.stock_almacen(v_alm.id) s where s.producto_id = p_producto_id;

    if v_stock > 0.005 then
      insert into public.ajustes_inventario
        (toma_fisica_id, producto_id, lote_id, almacen_id, stock_teorico, stock_real, registrado_por, motivo)
      values (null, p_producto_id, null, v_alm.id, v_stock, 0, p_usuario_id, 'vaciado_desechos');
      v_resultado := v_resultado || jsonb_build_object('almacen_id', v_alm.id, 'kg', v_stock);
    end if;
  end loop;

  return v_resultado;
end;
$function$;

revoke execute on function public.vaciar_desechos(uuid, uuid) from public, anon, authenticated;

commit;
