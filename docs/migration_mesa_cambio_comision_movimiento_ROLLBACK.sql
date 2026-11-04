-- =============================================================================
-- ROLLBACK de docs/migration_mesa_cambio_comision_movimiento.sql
--
-- Se niega a correr (y no cambia nada) si hay egresos de comisión VIGENTES: las transferencias a las que pertenecen
-- registran el bruto como monto_destino y, sin el egreso, sus saldos quedarían mal. Anula esas transferencias desde
-- Wallet antes (se anula también su comisión).
-- Las RPC cobrar_transferencia_mesa_cambio y anular_transferencia_mesa_cambio vuelven a su versión anterior
-- re-ejecutando docs/migration_mesa_cambio_cobro_parcial.sql (idempotente: CREATE OR REPLACE); hazlo DESPUÉS de este archivo.
-- La categoría "Comisión cambio de divisas" y los egresos anulados no se borran (historial).
-- =============================================================================

begin;

do $$
begin
  if exists (select 1 from public.movimientos where mesa_comision_de_id is not null and not anulado) then
    raise exception 'Hay egresos de comisión de mesa de cambio vigentes: anula esas transferencias antes del rollback.';
  end if;
end $$;

drop trigger if exists trg_movimientos_mesa_comision_proteger on public.movimientos;
drop function if exists public.movimientos_mesa_comision_proteger();

drop index if exists public.idx_movimientos_mesa_comision_de;
alter table public.movimientos drop constraint if exists movimientos_mesa_comision_de_coherente;
-- La columna se conserva mientras existan egresos anulados que la usan (historial); solo se borra si no hay ninguno.
do $$
begin
  if not exists (select 1 from public.movimientos where mesa_comision_de_id is not null) then
    alter table public.movimientos drop column if exists mesa_comision_de_id;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
