-- =============================================================================
-- ROLLBACK de docs/migration_exportacion_baja_inventario.sql
--
-- Se niega a correr si hay bajas de exportación registradas: borrarlas devolvería el material al inventario.
-- Si de verdad hace falta, borra antes esas filas de ajustes_inventario (motivo = 'exportacion').
-- =============================================================================

begin;

do $$
begin
  if exists (select 1 from public.ajustes_inventario where motivo = 'exportacion') then
    raise exception 'Hay bajas de inventario por exportación: bórralas antes del rollback si quieres devolver el material.';
  end if;
end $$;

drop function if exists public.dar_baja_exportacion(uuid, uuid);
drop index if exists public.idx_ajustes_inventario_packing_list;
alter table public.ajustes_inventario drop column if exists packing_list_id;

commit;

notify pgrst, 'reload schema';
