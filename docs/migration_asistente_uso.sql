-- BLOB: tope diario de preguntas por usuario (persistente; el limitador en memoria no sirve en Vercel).
--
-- - Tabla asistente_uso (user_id, dia, preguntas) con PK (user_id, dia). RLS activado sin políticas:
--   solo service_role (el backend) accede. REVOKE a anon/authenticated.
-- - Función asistente_registrar_uso(p_user, p_limite): incrementa y devuelve true si se permitió,
--   false si ya se alcanzó p_limite. Atómica: un único INSERT ... ON CONFLICT DO UPDATE ... WHERE.
-- - El día se calcula en hora de Venezuela (America/Caracas).
-- - EXECUTE revocado a public, anon y authenticated; solo service_role.
--
-- IDEMPOTENTE. Transaccional.
--
-- ROLLBACK:
--   begin;
--   drop function if exists public.asistente_registrar_uso(uuid, int);
--   drop table if exists public.asistente_uso;
--   commit;

begin;

create table if not exists public.asistente_uso (
  user_id    uuid    not null,
  dia        date    not null,
  preguntas  integer not null default 0,
  primary key (user_id, dia)
);

alter table public.asistente_uso enable row level security;
revoke all on table public.asistente_uso from public, anon, authenticated;
grant select, insert, update, delete on table public.asistente_uso to service_role;

create or replace function public.asistente_registrar_uso(p_user uuid, p_limite int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dia date := (now() at time zone 'America/Caracas')::date;
  v_total integer;
begin
  insert into public.asistente_uso as u (user_id, dia, preguntas)
  values (p_user, v_dia, 1)
  on conflict (user_id, dia) do update
    set preguntas = u.preguntas + 1
    where u.preguntas < p_limite
  returning u.preguntas into v_total;
  -- Sin fila devuelta: el conflicto no cumplió el WHERE (límite alcanzado).
  return v_total is not null;
end;
$$;

revoke execute on function public.asistente_registrar_uso(uuid, int) from public, anon, authenticated;
grant execute on function public.asistente_registrar_uso(uuid, int) to service_role;

commit;
