-- =============================================================================
-- BACKFILL OPCIONAL (NO se aplica con la migración): asiento COMISION para transferencias YA completadas.
--
-- migration_mesa_cambio_comision_asiento.sql solo crea el asiento COMISION en los cobros que completan una transferencia
-- DESPUÉS de aplicarla: las completadas antes NO cambian de saldo. Este script, si se decide ejecutarlo, CAMBIA
-- RETROACTIVAMENTE el saldo de los cambistas: por cada transferencia completada, vigente y con comisión > 0 que no
-- tenga asiento COMISION, agrega uno (fecha = día de la compleción, hora de Venezuela) que REDUCE el saldo (se le debe
-- más al cambista) por la comisión en USD (cargo x comisión / bruto, a centavos).
--
-- Antes de ejecutarlo: avisar a quien lleva las cuentas de los cambistas, hacer backup y revisar la VISTA PREVIA (paso 1).
-- Idempotente: no duplica (excluye transferencias que ya tienen asiento COMISION, vigente o anulado).
-- Requisito: migration_mesa_cambio_comision_asiento.sql aplicada.
-- Rollback: los asientos no se borran; se anulan desde Wallet anulando la transferencia, o con una N/D del mismo importe.
-- =============================================================================

-- 1. VISTA PREVIA (solo lectura) ------------------------------------------------------------
select m.id as movimiento_id, m.numero_sistema, m.mesa_cambista_id,
       m.mesa_comision, c.monto_usd as cargo_usd,
       round(c.monto_usd * m.mesa_comision / m.mesa_monto_bruto, 2) as comision_usd,
       (m.mesa_completada_at at time zone 'America/Caracas')::date as fecha
  from public.movimientos m
  join public.cambista_asientos c on c.movimiento_id = m.id and c.tipo = 'CARGO' and not c.anulado
 where m.mesa_estado = 'completada' and not m.anulado
   and coalesce(m.mesa_comision, 0) > 0 and m.mesa_monto_bruto > 0
   and round(c.monto_usd * m.mesa_comision / m.mesa_monto_bruto, 2) > 0
   and not exists (select 1 from public.cambista_asientos a where a.movimiento_id = m.id and a.tipo = 'COMISION')
 order by m.numero_sistema;

-- 2. APLICAR (descomentar begin/commit para ejecutarlo) --------------------------------------
-- begin;
-- insert into public.cambista_asientos (cambista_id, tipo, monto_usd, fecha, nota, referencia, registrado_por, movimiento_id)
-- select m.mesa_cambista_id, 'COMISION',
--        round(c.monto_usd * m.mesa_comision / m.mesa_monto_bruto, 2),
--        coalesce((m.mesa_completada_at at time zone 'America/Caracas')::date, m.fecha),
--        'Comisión de la mesa — transferencia ' || coalesce('MV-' || lpad(m.numero_sistema::text, 4, '0'), m.id::text)
--          || ' (regularización de transferencias completadas)',
--        m.referencia, m.mesa_completada_por, m.id
--   from public.movimientos m
--   join public.cambista_asientos c on c.movimiento_id = m.id and c.tipo = 'CARGO' and not c.anulado
--  where m.mesa_estado = 'completada' and not m.anulado
--    and coalesce(m.mesa_comision, 0) > 0 and m.mesa_monto_bruto > 0
--    and round(c.monto_usd * m.mesa_comision / m.mesa_monto_bruto, 2) > 0
--    and not exists (select 1 from public.cambista_asientos a where a.movimiento_id = m.id and a.tipo = 'COMISION');
-- commit;
