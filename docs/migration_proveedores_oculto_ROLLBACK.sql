-- ROLLBACK de migration_proveedores_oculto.sql. Los proveedores ocultos volverán a ser visibles para todos.
begin;
drop index if exists public.idx_proveedores_ocultos;
alter table public.proveedores drop column if exists oculto;
commit;
