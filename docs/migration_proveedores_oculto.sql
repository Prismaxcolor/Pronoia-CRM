-- =============================================================================
-- Proveedores: ocultar un proveedor al resto de los usuarios (solo lo ve el superadmin).
--
--   * proveedores.oculto boolean not null default false. El backend (services/proveedor-oculto.ts) excluye los
--     proveedores ocultos de listados, selectores, facturas, tickets, pagos, saldos, métricas, asistente y portal
--     para todo rol distinto de superadmin. Cambiarlo: POST /api/proveedores/:id/ocultar (solo superadmin, auditado).
--   * Los proveedores existentes quedan visibles (default false).
--
-- Migración aditiva e idempotente; no se aplica desde el código. Orden: migración PRIMERO, luego el código
-- (sin la columna, el código nuevo funciona pero nada queda oculto y ocultar devuelve error).
-- ROLLBACK: docs/migration_proveedores_oculto_ROLLBACK.sql
-- CÓMO APLICAR: Supabase Studio -> SQL Editor, con backup previo.
-- =============================================================================

begin;

alter table public.proveedores add column if not exists oculto boolean not null default false;

-- Índice parcial: la consulta de ocultos corre en cada petición de un usuario que no es superadmin.
create index if not exists idx_proveedores_ocultos on public.proveedores (id) where oculto;

commit;
