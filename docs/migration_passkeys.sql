-- =============================================================================
-- Passkeys (WebAuthn): entrar al sistema con huella / rostro / llave del dispositivo.
--
--   * public.passkeys           : credenciales registradas por cada usuario (varias por usuario).
--       - credential_id único (base64url); public_key en base64url (clave pública COSE).
--       - counter: contador de firmas, se actualiza en cada login (detecta clones).
--       - ultimo_uso: última vez que se usó para entrar.
--       - se borran en cascada si se borra el usuario; el usuario las elimina desde su configuración.
--   * public.passkey_challenges : challenges de un solo uso (registro o login) con vencimiento de 5 min.
--       Viven en tabla porque la app corre en serverless (no hay memoria compartida entre invocaciones).
--       El backend borra el challenge al usarlo y limpia los vencidos al crear uno nuevo.
--
-- Seguridad: RLS activado SIN políticas y REVOKE a anon/authenticated (solo service_role, el backend).
--
-- Migración aditiva e idempotente; no se aplica desde el código.
-- ROLLBACK: docs/migration_passkeys_ROLLBACK.sql
-- CÓMO APLICAR: Supabase Studio -> SQL Editor, con backup previo.
-- =============================================================================

begin;

create table if not exists public.passkeys (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references public.users(id) on delete cascade,
  credential_id text        not null unique,
  public_key    text        not null,
  counter       bigint      not null default 0,
  transports    text[]      not null default '{}',
  nombre        text        not null default 'Passkey' check (char_length(btrim(nombre)) between 1 and 80),
  creado_en     timestamptz not null default now(),
  ultimo_uso    timestamptz
);

create index if not exists idx_passkeys_user on public.passkeys (user_id);

create table if not exists public.passkey_challenges (
  id         uuid        primary key default gen_random_uuid(),
  challenge  text        not null,
  user_id    uuid        references public.users(id) on delete cascade,
  tipo       text        not null check (tipo in ('registro', 'login')),
  creado_en  timestamptz not null default now(),
  expira_en  timestamptz not null default (now() + interval '5 minutes')
);

create index if not exists idx_passkey_challenges_expira on public.passkey_challenges (expira_en);
create index if not exists idx_passkey_challenges_lookup on public.passkey_challenges (challenge, tipo);

-- Seguridad ----------------------------------------------------------------------
alter table public.passkeys           enable row level security;
alter table public.passkey_challenges enable row level security;

revoke all on table public.passkeys           from public, anon, authenticated;
revoke all on table public.passkey_challenges from public, anon, authenticated;

grant select, insert, update, delete on table public.passkeys           to service_role;
grant select, insert, update, delete on table public.passkey_challenges to service_role;

commit;
