-- Separar "ver" de "editar" en el acceso por usuario a cuentas/cajas (bancas).
--
-- Requiere migration_usuarios_bancas.sql ya aplicada.
--
-- Regla (la aplica el backend, utils/banca-acceso.ts):
--   * una fila en usuarios_bancas = el usuario puede VER la cuenta.
--   * puede_editar = true = ademas puede registrar/modificar/anular movimientos, pagos y cobros
--     que usen esa cuenta como origen o destino. false = solo consulta.
--   * el superadmin ve y edita todo (sin filas).
--
-- Las filas existentes quedan en puede_editar = true (default) para no cambiar el comportamiento actual.
-- Aditiva e idempotente. NO se aplica sola. Mientras la columna no exista, el backend trata
-- todo lo visible como editable (comportamiento anterior) y rechaza guardar accesos de solo consulta.

alter table public.usuarios_bancas
  add column if not exists puede_editar boolean not null default true;

-- Reemplazo atomico de los accesos de un usuario con permiso de edicion por cuenta
-- (lo usa PUT /api/usuarios/:id/bancas cuando alguna cuenta es de solo consulta).
-- Una sola transaccion: reemplaza e inserta solo ids de bancas que existen. Los ids de p_banca_ids_editar
-- que no esten en p_banca_ids se ignoran (editar nunca se otorga sin ver).
create or replace function public.reemplazar_accesos_bancas_usuario(
  p_usuario_id uuid,
  p_banca_ids uuid[],
  p_banca_ids_editar uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.usuarios_bancas where usuario_id = p_usuario_id;
  insert into public.usuarios_bancas (usuario_id, banca_id, puede_editar)
  select p_usuario_id, b.id, (b.id = any(coalesce(p_banca_ids_editar, '{}'::uuid[])))
  from public.bancas b
  where b.id = any(coalesce(p_banca_ids, '{}'::uuid[]));
end;
$$;

revoke all on function public.reemplazar_accesos_bancas_usuario(uuid, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.reemplazar_accesos_bancas_usuario(uuid, uuid[], uuid[]) to service_role;

-- Recarga el esquema de PostgREST (columna y funcion nuevas visibles para el backend sin reiniciar).
notify pgrst, 'reload schema';
