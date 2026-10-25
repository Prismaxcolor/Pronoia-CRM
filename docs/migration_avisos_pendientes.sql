-- =============================================================================
-- Cola de avisos pendientes (Telegram vía webhooks de n8n).
--
--   * public.avisos_pendientes : avisos que n8n no aceptó tras los reintentos inmediatos
--     (5xx, timeout, red, 429). El backend los reintenta desde POST /api/avisos/reprocesar
--     (cron de Vercel, protegido con CRON_SECRET) con backoff y un máximo de intentos.
--       - destino: 'contenido' (webhook v2 enviar-contenido) o 'grupo' (webhook del grupo de operaciones).
--       - payload: cuerpo JSON del aviso. NUNCA lleva secretos: el header X-Pronoia-Secret se
--         agrega al enviar. (Si trae una URL firmada de Storage, expira a las 24 h.)
--       - enviado_en: aviso entregado. fallido_en: se agotaron los intentos.
--       - proximo_intento: no se reintenta antes de esta fecha (también sirve de "reserva" mientras
--         una corrida procesa la fila).
--
-- Seguridad: RLS activado y deny-all para anon/authenticated; solo el backend Express (service_role,
-- que bypassa RLS) accede.
--
-- Migración aditiva e idempotente; no se aplica desde el código.
-- ROLLBACK: docs/migration_avisos_pendientes_ROLLBACK.sql
-- CÓMO APLICAR: Supabase Studio -> SQL Editor, con backup previo.
-- =============================================================================

begin;

create table if not exists public.avisos_pendientes (
  id              uuid        primary key default gen_random_uuid(),
  destino         text        not null check (destino in ('contenido', 'grupo')),
  payload         jsonb       not null,
  intentos        integer     not null default 0 check (intentos >= 0),
  ultimo_error    text,
  proximo_intento timestamptz not null default now(),
  creado_en       timestamptz not null default now(),
  enviado_en      timestamptz,
  fallido_en      timestamptz
);

-- Solo las filas vivas (ni enviadas ni fallidas) se consultan en cada corrida del cron.
create index if not exists idx_avisos_pendientes_cola
  on public.avisos_pendientes (proximo_intento)
  where enviado_en is null and fallido_en is null;

alter table public.avisos_pendientes enable row level security;
revoke all on table public.avisos_pendientes from anon, authenticated;

commit;
