-- Rollback de migration_wallet_correlativo.sql. Descarta los correlativos MV- ya asignados.
drop trigger if exists trg_asignar_numero_sistema_movimiento on public.movimientos;
drop function if exists public.asignar_numero_sistema_movimiento();
drop index if exists public.idx_movimientos_numero_sistema;
alter table public.movimientos drop column if exists numero_sistema;
drop sequence if exists public.movimientos_wallet_numero_seq;
