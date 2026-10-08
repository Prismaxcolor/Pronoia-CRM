-- =============================================================================
-- Mesa de cambio: cambistas (proveedores que nos hacen cambios de divisas) y su
-- estado de cuenta en USD.
--
-- Son ANOTACIONES de deuda: no tocan bancas, movimientos ni saldos de Wallet.
--   * public.cambistas          : el cambista (nombre, contacto, activo).
--   * public.cambista_asientos  : un importe en USD por asiento.
--       tipo 'CARGO' = aumenta lo que les debemos
--       tipo 'COBRO' = lo reduce (abono; si se pasa, nos deben a nosotros)
--       saldo = sum(CARGO) - sum(COBRO) de los asientos NO anulados
--       (positivo = les debemos; negativo = nos deben).
--     La tasa es solo un dato informativo opcional (no entra en el saldo).
--     Correlativo propio por asiento (numero, secuencia): se muestra MC-0001.
--   * public.cambistas_saldos   : vista con el saldo vigente por cambista.
--
-- Anulación en lugar de borrado: el asiento se conserva con anulado = true, motivo,
-- fecha y quién. Un trigger impide borrar asientos y cambiar sus importes/tipo/cambista
-- (solo se permite anular una vez y editar nota/referencia). Tampoco se pueden reescribir quién registró
-- (registrado_por), cuándo (created_at) ni, una vez anulado, el motivo/fecha/autor de la anulación; lo único
-- que se tolera es que registrado_por/anulado_por pasen a NULL (borrado del usuario, FK on delete set null).
--
-- Seguridad: RLS activado y deny-all para anon/authenticated; solo el backend Express
-- (service_role, que bypassa RLS) accede. La vista y la función no se exponen.
-- La función del trigger fija search_path vacío (objetos totalmente calificados).
--
-- Backend: backend/src/services/mesa-cambio-service.ts (permiso de módulo 'mesa_cambio').
-- El backend responde 503 en /api/mesa-cambio mientras estas tablas no existan.
--
-- Migración 100% aditiva e idempotente; no se aplica desde el código.
-- ROLLBACK: docs/migration_mesa_cambio_ROLLBACK.sql
-- CÓMO APLICAR: Supabase Studio -> SQL Editor, con backup previo.
-- =============================================================================

begin;

-- 1. Cambistas ---------------------------------------------------------------
create table if not exists public.cambistas (
  id          uuid        primary key default gen_random_uuid(),
  nombre      text        not null check (char_length(btrim(nombre)) between 1 and 120),
  telefono    text,
  email       text,
  notas       text,
  activo      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists idx_cambistas_nombre_unico
  on public.cambistas (lower(btrim(nombre)));

-- 2. Asientos ------------------------------------------------------------------
create sequence if not exists public.cambista_asientos_numero_seq;

create table if not exists public.cambista_asientos (
  id             uuid          primary key default gen_random_uuid(),
  numero         bigint        not null default nextval('public.cambista_asientos_numero_seq'),
  cambista_id    uuid          not null references public.cambistas(id) on delete restrict,
  tipo           text          not null check (tipo in ('CARGO', 'COBRO')),
  monto_usd      numeric(14,2) not null check (monto_usd > 0),
  tasa           numeric(18,6) check (tasa is null or tasa > 0),
  fecha          date          not null,
  nota           text,
  referencia     text,
  registrado_por uuid          references public.users(id) on delete set null,
  anulado        boolean       not null default false,
  anulado_motivo text,
  anulado_at     timestamptz,
  anulado_por    uuid          references public.users(id) on delete set null,
  created_at     timestamptz   not null default now(),
  constraint cambista_asientos_anulado_coherente
    check (not anulado or (anulado_at is not null and anulado_motivo is not null))
);

create unique index if not exists idx_cambista_asientos_numero
  on public.cambista_asientos (numero);
create index if not exists idx_cambista_asientos_cambista_fecha
  on public.cambista_asientos (cambista_id, fecha, numero);

-- 3. Inmutabilidad: no se borra y no se cambia lo contable --------------------
create or replace function public.cambista_asientos_proteger()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'Los asientos de la mesa de cambio no se borran: se anulan.'
      using errcode = '42501';
  end if;
  if new.cambista_id is distinct from old.cambista_id
     or new.tipo is distinct from old.tipo
     or new.monto_usd is distinct from old.monto_usd
     or new.tasa is distinct from old.tasa
     or new.fecha is distinct from old.fecha
     or new.numero is distinct from old.numero then
    raise exception 'No se puede cambiar el importe, tipo, fecha ni cambista de un asiento: anúlalo y registra otro.'
      using errcode = '42501';
  end if;
  if new.created_at is distinct from old.created_at
     or (new.registrado_por is distinct from old.registrado_por and new.registrado_por is not null) then
    raise exception 'No se puede cambiar quién registró el asiento ni cuándo.' using errcode = '42501';
  end if;
  if old.anulado and new.anulado is distinct from old.anulado then
    raise exception 'Un asiento anulado no se puede reactivar.' using errcode = '42501';
  end if;
  if old.anulado
     and (new.anulado_motivo is distinct from old.anulado_motivo
          or new.anulado_at is distinct from old.anulado_at
          or (new.anulado_por is distinct from old.anulado_por and new.anulado_por is not null)) then
    raise exception 'No se puede cambiar el motivo, la fecha ni el autor de una anulación.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke execute on function public.cambista_asientos_proteger() from public, anon, authenticated;

drop trigger if exists trg_cambista_asientos_proteger on public.cambista_asientos;
create trigger trg_cambista_asientos_proteger
  before update or delete on public.cambista_asientos
  for each row execute function public.cambista_asientos_proteger();

-- 4. Saldos por cambista -------------------------------------------------------
create or replace view public.cambistas_saldos
with (security_invoker = true) as
  select c.id as cambista_id,
         coalesce(sum(case when a.tipo = 'CARGO' then a.monto_usd else 0 end), 0)::numeric(14,2) as total_cargos,
         coalesce(sum(case when a.tipo = 'COBRO' then a.monto_usd else 0 end), 0)::numeric(14,2) as total_cobros,
         coalesce(sum(case when a.tipo = 'CARGO' then a.monto_usd else -a.monto_usd end), 0)::numeric(14,2) as saldo,
         count(a.id)::int as asientos
    from public.cambistas c
    left join public.cambista_asientos a on a.cambista_id = c.id and not a.anulado
   group by c.id;

revoke all on public.cambistas_saldos from public, anon, authenticated;
grant select on public.cambistas_saldos to service_role;

-- 5. RLS: deny-all para anon/authenticated (service_role bypassa RLS) -----------
alter table public.cambistas enable row level security;
alter table public.cambista_asientos enable row level security;

revoke all on public.cambistas from anon, authenticated;
revoke all on public.cambista_asientos from anon, authenticated;
revoke all on sequence public.cambista_asientos_numero_seq from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'cambistas' and policyname = 'cambistas_deny_anon'
  ) then
    create policy cambistas_deny_anon
      on public.cambistas for all to anon, authenticated using (false) with check (false);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'cambista_asientos' and policyname = 'cambista_asientos_deny_anon'
  ) then
    create policy cambista_asientos_deny_anon
      on public.cambista_asientos for all to anon, authenticated using (false) with check (false);
  end if;
end $$;

commit;
