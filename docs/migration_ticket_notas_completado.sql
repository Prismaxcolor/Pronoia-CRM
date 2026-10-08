-- =============================================================================
-- Notas al completar un ticket de pesaje
-- =============================================================================
-- ADITIVA E IDEMPOTENTE. El backend tolera que la columna aun no exista: sin
-- ella, las notas escritas al completar no se guardan (queda un aviso en el log).
--
-- ROLLBACK:
--   alter table public.tickets_pesaje drop column if exists notas_completado;
-- =============================================================================

alter table public.tickets_pesaje
  add column if not exists notas_completado text null;
