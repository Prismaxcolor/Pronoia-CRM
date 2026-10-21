-- Rollback de migration_usuarios_bancas_editar.sql.
-- Se pierde la distincion solo-consulta/edicion: todas las cuentas asignadas vuelven a ser editables.
-- Si existe alguna fila con puede_editar = false, el rollback ABORTA: esos usuarios pasarian a poder editar.
-- Revisa esas filas (lista abajo) y, si aceptas que ganen edicion, ejecuta antes:
--   update public.usuarios_bancas set puede_editar = true where not puede_editar;
begin;

do $$
declare
  v_n integer;
begin
  select count(*) into v_n from public.usuarios_bancas where puede_editar = false;
  if v_n > 0 then
    raise exception 'Hay % acceso(s) de solo consulta (puede_editar = false). Revisa/acepta que esos usuarios pasaran a poder editar antes del rollback (ver comentario al inicio del archivo).', v_n;
  end if;
end $$;

drop function if exists public.reemplazar_accesos_bancas_usuario(uuid, uuid[], uuid[]);
alter table public.usuarios_bancas drop column if exists puede_editar;

commit;

notify pgrst, 'reload schema';
