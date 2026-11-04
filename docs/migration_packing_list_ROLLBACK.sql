-- Rollback de migration_packing_list.sql. Borra los packing lists y la configuración de empresas.
begin;
drop function if exists public.guardar_packing_list(uuid, jsonb, jsonb, uuid);
drop table if exists public.packing_list_items;
drop table if exists public.packing_lists;
drop table if exists public.packing_list_empresas;
commit;
