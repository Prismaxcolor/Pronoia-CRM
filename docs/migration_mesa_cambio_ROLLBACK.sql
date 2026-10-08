-- =============================================================================
-- ROLLBACK de docs/migration_mesa_cambio.sql
--
-- ATENCIÓN: borra TODOS los cambistas y asientos de la mesa de cambio (no se pueden
-- recuperar). Haz un respaldo antes si ya hay datos reales:
--   create table public._bak_cambista_asientos as select * from public.cambista_asientos;
--   create table public._bak_cambistas as select * from public.cambistas;
--
-- No afecta ninguna otra tabla (la mesa de cambio no toca Wallet ni bancas).
-- Si el trigger de protección bloquea el borrado, el drop de la tabla lo elimina igual.
-- =============================================================================

begin;

drop view if exists public.cambistas_saldos;
drop trigger if exists trg_cambista_asientos_proteger on public.cambista_asientos;
drop table if exists public.cambista_asientos;
drop table if exists public.cambistas;
drop function if exists public.cambista_asientos_proteger();
drop sequence if exists public.cambista_asientos_numero_seq;

commit;
