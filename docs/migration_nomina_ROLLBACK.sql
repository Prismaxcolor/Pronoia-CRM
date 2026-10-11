-- =============================================================================
-- ROLLBACK de docs/migration_nomina.sql
--
-- ATENCIÓN: borra TODOS los trabajadores, préstamos, nóminas y su historial (no se pueden recuperar).
-- Haz un respaldo antes si ya hay datos reales:
--   create table public._bak_nomina_trabajadores as select * from public.nomina_trabajadores;
--   create table public._bak_nomina_prestamos as select * from public.nomina_prestamos;
--   create table public._bak_nominas as select * from public.nominas;
--   create table public._bak_nomina_lineas as select * from public.nomina_lineas;
--   create table public._bak_nomina_linea_cuotas as select * from public.nomina_linea_cuotas;
--   create table public._bak_nomina_prestamo_movimientos as select * from public.nomina_prestamo_movimientos;
-- (los respaldos también contienen datos personales: protégelos igual o bórralos al terminar).
--
-- No afecta ninguna otra tabla (la nómina no toca Wallet ni bancas).
-- Si los triggers de protección bloquean el borrado, el drop de la tabla los elimina igual.
-- =============================================================================

begin;

drop function if exists public.nomina_guardar(jsonb, uuid);
drop function if exists public.nomina_cerrar(uuid, uuid);
drop function if exists public.nomina_anular(uuid, text, uuid);

drop table if exists public.nomina_prestamo_movimientos;
drop table if exists public.nomina_linea_cuotas;
drop table if exists public.nomina_lineas;
drop table if exists public.nominas;
drop table if exists public.nomina_prestamos;
drop table if exists public.nomina_trabajadores;

drop function if exists public.nomina_trabajadores_proteger();
drop function if exists public.nominas_proteger();
drop function if exists public.nomina_hijos_proteger();
drop function if exists public.nomina_prestamos_proteger();
drop function if exists public.nomina_movimientos_proteger();

drop sequence if exists public.nomina_numero_seq;
drop sequence if exists public.nomina_prestamo_numero_seq;

commit;
