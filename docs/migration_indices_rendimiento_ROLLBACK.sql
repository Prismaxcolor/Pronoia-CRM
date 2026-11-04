-- Revierte docs/migration_indices_rendimiento.sql (solo quita índices; no toca datos).
DROP INDEX IF EXISTS public.idx_movimientos_banca_origen_fecha;
DROP INDEX IF EXISTS public.idx_movimientos_banca_destino_fecha;
DROP INDEX IF EXISTS public.idx_movimientos_fecha;
DROP INDEX IF EXISTS public.idx_cambista_asientos_cambista_numero;
