-- ROLLBACK de docs/migration_nomina_trabajador_puesto.sql (se pierde el puesto cargado).
begin;
alter table public.nomina_trabajadores drop constraint if exists nomina_trabajadores_puesto_largo;
alter table public.nomina_trabajadores drop column if exists puesto;
commit;
notify pgrst, 'reload schema';
