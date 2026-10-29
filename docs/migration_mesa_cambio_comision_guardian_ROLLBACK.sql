begin;
drop trigger if exists trg_movimientos_mesa_comision_proteger on public.movimientos;
create trigger trg_movimientos_mesa_comision_proteger
  before update on public.movimientos
  for each row
  when (old.mesa_comision_de_id is not null)
  execute function public.movimientos_mesa_comision_proteger();
commit;
