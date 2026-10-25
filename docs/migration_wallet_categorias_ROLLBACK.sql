-- =============================================================================
-- ROLLBACK de docs/migration_wallet_categorias.sql
--
-- ATENCIÓN: borra TODAS las categorías del Wallet y la categoría asignada a cada movimiento (no se
-- puede recuperar). Los movimientos, montos y saldos NO se tocan; solo pierden su categoría.
-- Haz un respaldo antes si ya hay datos reales:
--   create table public._bak_categorias_wallet as select * from public.categorias_wallet;
--   create table public._bak_movimientos_categoria as
--     select id, categoria_id from public.movimientos where categoria_id is not null;
--
-- Orden: primero el trigger y la columna de movimientos (que referencia a las categorías), luego la tabla.
-- =============================================================================

begin;

drop trigger if exists trg_movimientos_validar_categoria on public.movimientos;
drop index if exists public.idx_movimientos_categoria_fecha;
alter table public.movimientos drop column if exists categoria_id;
drop function if exists public.movimientos_validar_categoria();

drop trigger if exists trg_categorias_wallet_validar on public.categorias_wallet;
drop table if exists public.categorias_wallet;
drop function if exists public.categorias_wallet_validar();

commit;
