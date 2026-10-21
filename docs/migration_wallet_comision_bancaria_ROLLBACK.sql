-- =============================================================================
-- ROLLBACK de migration_wallet_comision_bancaria.sql.
--
-- Quita las RPC, el guardián y las columnas. Los cargos de comisión ya creados QUEDAN como egresos normales
-- (con su concepto "Comisión bancaria 0.3% – MV-xxxx"): el saldo de las cuentas no cambia, solo se pierde el
-- vínculo entre el movimiento y su cargo. Si hay movimientos con comisión que se quieren anular, anúlalos ANTES
-- de revertir (después ya no se anularán juntos). Hacer backup antes de ejecutar.
-- =============================================================================

begin;

drop function if exists public.crear_movimiento_con_comision_bancaria(text, uuid, uuid, numeric, numeric, text, text, date, uuid, uuid, uuid);
drop function if exists public.anular_movimiento_con_comision_bancaria(uuid, text, uuid);

drop trigger if exists trg_movimientos_comision_proteger on public.movimientos;
drop function if exists public.movimientos_comision_proteger();

drop index if exists public.idx_movimientos_comision_de;
alter table public.movimientos drop constraint if exists movimientos_comision_coherente;
alter table public.movimientos
  drop column if exists comision_de_id,
  drop column if exists comision_bancaria;

commit;
