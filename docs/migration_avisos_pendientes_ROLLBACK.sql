-- =============================================================================
-- ROLLBACK de docs/migration_avisos_pendientes.sql
--
-- ATENCIÓN: elimina la cola de avisos pendientes (los avisos aún no entregados se pierden).
-- El backend tolera que la tabla no exista: solo registra el error y sigue.
-- =============================================================================

begin;

drop index if exists public.idx_avisos_pendientes_cola;
drop table if exists public.avisos_pendientes;

commit;
