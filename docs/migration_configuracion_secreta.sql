-- Configuración y secretos que el backend lee en tiempo de ejecución (claves de IA, secreto
-- compartido con n8n). Alternativa a las variables de entorno de Vercel: el repo es público,
-- así que ningún secreto va en el código; aquí viven solo para el rol service_role.
--
-- Seguridad: RLS activado sin políticas y permisos revocados a public/anon/authenticated.
-- ROLLBACK: eliminar la tabla public.configuracion_secreta (no hay otras dependencias).
begin;

create table if not exists public.configuracion_secreta (
  clave          text primary key,
  valor          text not null,
  descripcion    text,
  actualizado_en timestamptz not null default now()
);

alter table public.configuracion_secreta enable row level security;
revoke all on public.configuracion_secreta from public, anon, authenticated;
grant all on public.configuracion_secreta to service_role;

commit;
