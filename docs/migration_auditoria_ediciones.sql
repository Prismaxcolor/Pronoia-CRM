-- =============================================================================
-- Auditoría de ediciones + llaves de edición de un solo uso.
--
-- Datos: dos tablas NUEVAS (auditoria_ediciones, llaves_edicion). No toca
-- ninguna tabla existente. Las usa solo el backend Express (service_role);
-- importadores: backend/src/services/auditoria-service.ts y
-- backend/src/services/llave-edicion-service.ts. Instrucción del usuario:
-- migración 100% aditiva e idempotente, no se aplica desde el código.
--
-- ROLLBACK (manual, solo si hiciera falta; estas tablas son nuevas):
--   drop table if exists public.llaves_edicion;
--   drop table if exists public.auditoria_ediciones;
--
-- CÓMO APLICAR: Supabase Studio → SQL Editor, con backup previo, PRIMERO en
-- staging. El backend tolera que las tablas aún no existan (registrar auditoría
-- solo loguea el fallo), así que se puede desplegar el código antes o después.
--
-- RLS (docs/rls-plan.md, Fase B): tablas que solo toca el backend → deny-all
-- para anon. service_role (backend) bypassa RLS.
-- =============================================================================

create table if not exists public.auditoria_ediciones (
  id                   uuid        primary key default gen_random_uuid(),
  entidad_tipo         text        not null,  -- 'ticket_pesaje' | 'factura_compra' | 'factura_venta' | 'transformacion'
  entidad_id           uuid        not null,
  accion               text        not null,  -- 'editar', ...
  usuario_id           uuid        references public.users(id) on delete set null,
  usuario_nombre       text        not null,  -- snapshot: sobrevive a renombres/borrados del usuario
  autorizado_por       uuid        references public.users(id) on delete set null,  -- superadmin que entregó la llave (null si editó el propio superadmin)
  autorizado_por_nombre text,
  cambios              jsonb       not null default '{}'::jsonb,  -- { "<campo>": { "antes": ..., "despues": ... } }
  created_at           timestamptz not null default now()
);

create index if not exists idx_auditoria_ediciones_entidad
  on public.auditoria_ediciones (entidad_tipo, entidad_id, created_at desc);

create table if not exists public.llaves_edicion (
  id            uuid        primary key default gen_random_uuid(),
  token_hash    text        not null unique,  -- sha256 hex del código; el código en claro nunca se guarda
  entidad_tipo  text        not null,
  entidad_id    uuid        not null,
  creada_por    uuid        references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  expira_en     timestamptz not null,         -- created_at + 15 min
  usada_en      timestamptz,                  -- null = disponible; un solo uso
  usada_por     uuid        references public.users(id) on delete set null
);

create index if not exists idx_llaves_edicion_entidad
  on public.llaves_edicion (entidad_tipo, entidad_id);

create index if not exists idx_llaves_edicion_expira_en
  on public.llaves_edicion (expira_en);

-- RLS deny-all para anon (idempotente: create policy no admite IF NOT EXISTS).
alter table public.auditoria_ediciones enable row level security;
alter table public.llaves_edicion enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'auditoria_ediciones'
      and policyname = 'auditoria_ediciones_deny_anon'
  ) then
    create policy auditoria_ediciones_deny_anon
      on public.auditoria_ediciones for all to anon using (false) with check (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'llaves_edicion'
      and policyname = 'llaves_edicion_deny_anon'
  ) then
    create policy llaves_edicion_deny_anon
      on public.llaves_edicion for all to anon using (false) with check (false);
  end if;
end $$;
