-- Endurece el guardián del egreso de comisión de la mesa de cambio: también se dispara cuando un UPDATE
-- intenta ASIGNAR mesa_comision_de_id a un movimiento que no lo tenía (la función ya rechaza el cambio).
-- Requisito: migration_mesa_cambio_comision_movimiento.sql. Idempotente.
begin;
drop trigger if exists trg_movimientos_mesa_comision_proteger on public.movimientos;
create trigger trg_movimientos_mesa_comision_proteger
  before update on public.movimientos
  for each row
  when (old.mesa_comision_de_id is not null or new.mesa_comision_de_id is not null)
  execute function public.movimientos_mesa_comision_proteger();
commit;
