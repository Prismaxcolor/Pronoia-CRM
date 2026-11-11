-- ROLLBACK de migration_productos_oculto.sql. Los productos ocultos volverán a ser visibles para todos.
begin;
drop index if exists public.idx_productos_ocultos;
alter table public.productos drop column if exists oculto;
commit;
