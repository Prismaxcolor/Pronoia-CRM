-- Deshace docs/migration_categorias_uso.sql. Los movimientos ya clasificados conservan su categoría.
begin;
drop table if exists public.categorias_uso;
commit;
notify pgrst, 'reload schema';
