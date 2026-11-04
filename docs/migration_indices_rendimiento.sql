-- =============================================================================
-- Rendimiento de lecturas del Wallet y la Mesa de cambio: índices que faltan.
--
-- Evidencia (EXPLAIN de solo lectura, 2026-10-11, 79 movimientos): el reporte de una cuenta
--   WHERE (banca_origen_id = X OR banca_destino_id = X) AND fecha BETWEEN ... ORDER BY fecha, creado_en, id
-- hace Seq Scan sobre movimientos: la tabla no tiene ningún índice en banca_origen_id, banca_destino_id ni fecha
-- (solo categoria+fecha, proveedor, cliente, grupo, etc.). Con 79 filas no se nota; con decenas de miles, cada
-- reporte leería toda la tabla. Lo mismo el reporte por categorías con "todas" o "sin categoría" (filtra por fecha).
-- En cambista_asientos el estado de cuenta filtra por cambista_id y ordena por numero (hoy dos índices separados).
--
-- Aditiva e idempotente (IF NOT EXISTS). No cambia datos ni resultados. Crear un índice bloquea las ESCRITURAS de la
-- tabla mientras se construye (segundos con estos volúmenes). No se aplica desde el código.
-- ROLLBACK: docs/migration_indices_rendimiento_ROLLBACK.sql
-- CÓMO APLICAR: Supabase Studio -> SQL Editor, con backup previo, fuera de horas de operación.
-- VERIFICAR: EXPLAIN de la consulta del reporte; debe usar "Bitmap Index Scan" en estos índices cuando la tabla crezca.
-- =============================================================================

-- Reporte de una cuenta: movimientos donde la cuenta es origen (BitmapOr con el de destino), acotados por fecha.
CREATE INDEX IF NOT EXISTS idx_movimientos_banca_origen_fecha
  ON public.movimientos (banca_origen_id, fecha);

CREATE INDEX IF NOT EXISTS idx_movimientos_banca_destino_fecha
  ON public.movimientos (banca_destino_id, fecha)
  WHERE banca_destino_id IS NOT NULL;

-- Reporte por categorías (todas / sin categoría) y listados por rango de fechas.
CREATE INDEX IF NOT EXISTS idx_movimientos_fecha
  ON public.movimientos (fecha);

-- Estado de cuenta de un cambista: filas de un cambista ya ordenadas por número (evita el sort).
CREATE INDEX IF NOT EXISTS idx_cambista_asientos_cambista_numero
  ON public.cambista_asientos (cambista_id, numero);
