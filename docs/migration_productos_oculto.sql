-- =============================================================================
-- Productos: ocultar un producto al resto de los usuarios (solo lo ve el superadmin).
--
--   * productos.oculto boolean not null default false. El backend (services/producto-oculto.ts) excluye los
--     productos ocultos del catálogo, inventario (stock, resumen, pantalla), selectores, listas de precios y asistente
--     para todo rol distinto de superadmin y para el portal. Cambiarlo: POST /api/productos/:id/ocultar
--     (solo superadmin, auditado). Los documentos históricos (facturas, tickets, movimientos) no se modifican.
--   * Los productos existentes quedan visibles (default false).
--
-- Migración aditiva e idempotente; no se aplica desde el código. Orden: migración PRIMERO, luego el código
-- (sin la columna, el código nuevo funciona pero nada queda oculto y ocultar devuelve error).
-- ROLLBACK: docs/migration_productos_oculto_ROLLBACK.sql
-- CÓMO APLICAR: Supabase Studio -> SQL Editor, con backup previo.
-- =============================================================================

begin;

alter table public.productos add column if not exists oculto boolean not null default false;

-- Índice parcial: la consulta de ocultos corre en cada petición de un usuario que no es superadmin.
create index if not exists idx_productos_ocultos on public.productos (id) where oculto;

commit;
