-- Revierte docs/migration_proveedores_direccion.sql (se pierden las direcciones guardadas).
begin;
alter table public.proveedores drop constraint if exists proveedores_direccion_largo;
alter table public.proveedores drop column if exists direccion;
commit;
notify pgrst, 'reload schema';
