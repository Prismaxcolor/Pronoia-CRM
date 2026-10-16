-- =============================================================================
-- Solicitudes de llave de edición (aprobación por el superadmin).
--
-- Datos: tabla NUEVA public.solicitudes_llave. No toca ninguna tabla existente
-- (solo referencia llaves_edicion y users). La usa solo el backend Express
-- (service_role): backend/src/services/solicitud-llave-service.ts.
-- Requiere antes: docs/migration_auditoria_ediciones.sql (llaves_edicion).
-- Migración 100% aditiva e idempotente; no se aplica desde el código.
--
-- codigo_cifrado: código de la llave cifrado con AES-256-GCM (clave derivada del
-- secreto del backend). Se entrega UNA vez al solicitante y se pone en NULL.
--
-- ROLLBACK (manual; la tabla es nueva):
--   drop table if exists public.solicitudes_llave;
--
-- CÓMO APLICAR: Supabase Studio → SQL Editor, con backup previo. El backend
-- responde 503 en las rutas de solicitudes mientras la tabla no exista.
-- RLS: deny-all para anon (service_role bypassa RLS).
-- =============================================================================

create table if not exists public.solicitudes_llave (
  id                    uuid        primary key default gen_random_uuid(),
  solicitante_id        uuid        references public.users(id) on delete set null,
  solicitante_nombre    text        not null,  -- snapshot
  entidad_tipo          text        not null,
  entidad_id            uuid        not null,
  descripcion           text        not null,  -- texto legible de lo que se quiere editar
  motivo                text        not null check (char_length(motivo) between 3 and 300),
  estado                text        not null default 'pendiente'
                                    check (estado in ('pendiente','aprobada','rechazada','usada','expirada')),
  aprobador_id          uuid        references public.users(id) on delete set null,
  aprobador_nombre      text,
  motivo_rechazo        text,
  resuelta_en           timestamptz,
  llave_id              uuid        references public.llaves_edicion(id) on delete set null,
  codigo_cifrado        text,
  codigo_entregado_en   timestamptz,
  created_at            timestamptz not null default now(),
  expira_en             timestamptz not null default (now() + interval '30 minutes')
);

create index if not exists idx_solicitudes_llave_estado
  on public.solicitudes_llave (estado, created_at desc);

create index if not exists idx_solicitudes_llave_solicitante
  on public.solicitudes_llave (solicitante_id, created_at desc);

alter table public.solicitudes_llave enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'solicitudes_llave'
      and policyname = 'solicitudes_llave_deny_anon'
  ) then
    create policy solicitudes_llave_deny_anon
      on public.solicitudes_llave for all to anon using (false) with check (false);
  end if;
end $$;
