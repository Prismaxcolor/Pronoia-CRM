-- =============================================================================
-- Pagos y cobros: tabla de reparación de pasos posteriores al movimiento de dinero
-- =============================================================================
-- Después de registrar un pago o cobro (RPC que mueve el dinero) quedan tres pasos secundarios: la categoría del
-- Wallet, las fotos del comprobante y la comisión bancaria de las cuentas en Bs. Hasta ahora, si uno fallaba, solo se
-- devolvía una `advertencia` y se perdía el rastro. Esta tabla guarda cada paso fallido para reintentarlo:
--   * el backend lo reintenta UNA vez de inmediato (pagos-pasos-service.ts);
--   * reintentarPasosPendientes() (cron) reintenta los que sigan sin resolver, hasta 5 intentos;
--   * la respuesta al cliente sigue trayendo `advertencia` mientras quede algo pendiente.
--
-- Contenido (aditivo; no modifica datos ni funciones existentes):
--   1. Tabla public.pagos_pasos_pendientes (RLS deny-all: solo service_role, que la omite).
--   2. Índice parcial de los pendientes sin resolver.
--
-- Orden de aplicación: ESTA primero; luego docs/migration_idempotencia_pagos_cobros.sql (que la exige).
-- Seguro de repetir (if not exists). ROLLBACK: docs/migration_pagos_pasos_pendientes_ROLLBACK.sql.
-- Hacer backup antes de aplicar. NO se aplica sola. Sin ella el backend solo registra el fallo en el log (como antes).
-- =============================================================================

begin;

create table if not exists public.pagos_pasos_pendientes (
  id                 uuid primary key default gen_random_uuid(),
  grupo_id           uuid,
  movimiento_id      uuid,
  paso               text not null check (paso in ('categoria', 'comprobante', 'comision')),
  -- Lo necesario para repetir el paso: categoria {movimientoIds, categoriaId}; comprobante {movimientoId, comprobantes};
  -- comision {movimientoIds, grupoId, bancaId, usuarioId}.
  detalle            jsonb not null default '{}'::jsonb,
  error              text,
  intentos           integer not null default 0,
  creado_en          timestamptz not null default now(),
  ultimo_intento_en  timestamptz,
  resuelto_at        timestamptz,
  constraint pagos_pasos_pendientes_ref check (grupo_id is not null or movimiento_id is not null)
);

create index if not exists idx_pagos_pasos_pendientes_sin_resolver
  on public.pagos_pasos_pendientes (creado_en)
  where resuelto_at is null;

-- RLS deny-all: sin políticas, solo service_role puede leer/escribir.
alter table public.pagos_pasos_pendientes enable row level security;
revoke all on public.pagos_pasos_pendientes from anon, authenticated;

commit;
