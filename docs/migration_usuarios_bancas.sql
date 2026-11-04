-- Acceso por usuario a cuentas/cajas (bancas).
--
-- Regla (la aplica el backend, utils/banca-acceso.ts):
--   * solo el superadmin ve TODAS las bancas (sin filas en esta tabla) y administra los accesos.
--   * cualquier otro usuario (incluida administracion) solo ve/usa las bancas con fila (usuario_id, banca_id).
--   * un usuario SIN filas no ve ninguna (lo más seguro).
--
-- El backfill da filas solo a los superadmin existentes (ya ven todo por rol; sirve para que la tabla
-- lo refleje). Administracion y trabajadores quedan SIN cuentas hasta que un superadmin se las asigne
-- desde Usuarios > permisos.
-- Las bancas que se creen más adelante NO se asignan solas: hay que concederlas por usuario.
--
-- Aditiva e idempotente. NO se aplica sola. Mientras la tabla no exista, el backend no filtra
-- (comportamiento anterior) para no bloquear la app entre el deploy y la migración.

create table if not exists public.usuarios_bancas (
  usuario_id uuid not null references public.users(id) on delete cascade,
  banca_id   uuid not null references public.bancas(id) on delete cascade,
  creado_en  timestamptz not null default now(),
  primary key (usuario_id, banca_id)
);

create index if not exists idx_usuarios_bancas_banca on public.usuarios_bancas (banca_id);

alter table public.usuarios_bancas enable row level security;
revoke all on public.usuarios_bancas from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'usuarios_bancas' and policyname = 'usuarios_bancas_deny_anon'
  ) then
    create policy usuarios_bancas_deny_anon
      on public.usuarios_bancas for all to anon, authenticated using (false) with check (false);
  end if;
end $$;

insert into public.usuarios_bancas (usuario_id, banca_id)
select u.id, b.id
from public.users u
cross join public.bancas b
where u.rol = 'superadmin'
on conflict do nothing;

-- Reemplazo atómico de las bancas de un usuario (lo usa PUT /api/usuarios/:id/bancas).
-- Una sola transacción: borra e inserta solo ids de bancas que existen; si algo falla, no cambia nada
-- (antes un insert fallido dejaba al usuario sin ninguna banca).
create or replace function public.reemplazar_bancas_usuario(p_usuario_id uuid, p_banca_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.usuarios_bancas where usuario_id = p_usuario_id;
  insert into public.usuarios_bancas (usuario_id, banca_id)
  select distinct p_usuario_id, b.id
  from public.bancas b
  where b.id = any(coalesce(p_banca_ids, '{}'::uuid[]));
end;
$$;

revoke all on function public.reemplazar_bancas_usuario(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reemplazar_bancas_usuario(uuid, uuid[]) to service_role;
