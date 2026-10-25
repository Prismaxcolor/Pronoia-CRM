-- =============================================================================
-- Wallet: categorías y subcategorías de movimientos.
--
--   * public.categorias_wallet : categorías de DOS niveles (categoría y subcategoría).
--       - nombre único dentro de su padre (sin distinguir mayúsculas ni espacios en los bordes).
--       - tipo: INGRESO / EGRESO / AMBOS. Una subcategoría no puede ser más amplia que su categoría.
--       - color: hex #RRGGBB en mayúsculas.
--       - activo: archivar = activo false (nunca se borra; los movimientos conservan su categoría).
--   * public.movimientos.categoria_id : categoría o subcategoría del movimiento (nullable, FK).
--       Los movimientos históricos quedan en null ("Sin categoría"). Las transferencias no llevan categoría.
--
-- Reglas que la BD repite (el backend ya las valida antes, estos triggers son la red de seguridad):
--   - dos niveles: el padre de una categoría debe ser una categoría raíz; el padre no se cambia;
--   - el tipo de una subcategoría cabe en el de su padre; no se estrecha el tipo de un padre si una
--     subcategoría quedaría fuera; no se reactiva una subcategoría con padre archivado;
--   - un movimiento solo recibe una categoría activa (y de padre activo) cuyo tipo acepta su tipo.
--     Se valida al insertar o al cambiar categoria_id; editar otras columnas no lo revalida.
--
-- Seguridad: RLS activado y deny-all para anon/authenticated; solo el backend Express (service_role,
-- que bypassa RLS) accede. Las funciones fijan search_path vacío (objetos totalmente calificados) y
-- no son ejecutables por public/anon/authenticated.
--
-- Backend: backend/src/services/categoria-service.ts y reporte-wallet-service.ts (permiso de módulo
-- 'cochinito'). El backend responde 503 en /api/cochinito/categorias mientras esta tabla no exista y el
-- Wallet sigue funcionando sin categorías.
--
-- Migración aditiva e idempotente; no se aplica desde el código.
-- ROLLBACK: docs/migration_wallet_categorias_ROLLBACK.sql
-- CÓMO APLICAR: Supabase Studio -> SQL Editor, con backup previo.
-- =============================================================================

begin;

-- 1. Categorías ---------------------------------------------------------------
create table if not exists public.categorias_wallet (
  id          uuid        primary key default gen_random_uuid(),
  nombre      text        not null check (char_length(btrim(nombre)) between 1 and 80),
  tipo        text        not null check (tipo in ('INGRESO', 'EGRESO', 'AMBOS')),
  color       text        not null default '#475569' check (color ~ '^#[0-9A-F]{6}$'),
  padre_id    uuid        references public.categorias_wallet(id) on delete restrict,
  activo      boolean     not null default true,
  created_by  uuid        references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint categorias_wallet_sin_autopadre check (padre_id is null or padre_id <> id)
);

-- Nombre único dentro de su padre (las categorías raíz comparten el "padre" nulo).
create unique index if not exists idx_categorias_wallet_nombre_unico
  on public.categorias_wallet (coalesce(padre_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(nombre)));
create index if not exists idx_categorias_wallet_padre
  on public.categorias_wallet (padre_id) where padre_id is not null;

-- 2. Reglas de dos niveles y de tipo -------------------------------------------
create or replace function public.categorias_wallet_validar()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_padre public.categorias_wallet%rowtype;
begin
  if tg_op = 'UPDATE' and new.padre_id is distinct from old.padre_id then
    raise exception 'No se puede cambiar la categoría padre: crea otra subcategoría y archiva la anterior.';
  end if;

  if new.padre_id is not null then
    select * into v_padre from public.categorias_wallet where id = new.padre_id;
    if not found then
      raise exception 'La categoría padre no existe.';
    end if;
    if v_padre.padre_id is not null then
      raise exception 'Solo hay dos niveles: una subcategoría no puede tener subcategorías.';
    end if;
    if v_padre.tipo <> 'AMBOS' and v_padre.tipo <> new.tipo then
      raise exception 'El tipo de la subcategoría no puede ser más amplio que el de su categoría.';
    end if;
    if new.activo and not v_padre.activo and (tg_op = 'INSERT' or not old.activo) then
      raise exception 'La categoría padre está archivada.';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.tipo is distinct from old.tipo and new.tipo <> 'AMBOS'
     and exists (select 1 from public.categorias_wallet h where h.padre_id = new.id and h.tipo <> new.tipo) then
    raise exception 'Hay subcategorías con un tipo que no cabe en el nuevo tipo: cámbialas primero.';
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

revoke execute on function public.categorias_wallet_validar() from public, anon, authenticated;

drop trigger if exists trg_categorias_wallet_validar on public.categorias_wallet;
create trigger trg_categorias_wallet_validar
  before insert or update on public.categorias_wallet
  for each row execute function public.categorias_wallet_validar();

-- 3. Categoría en movimientos ----------------------------------------------------
alter table public.movimientos
  add column if not exists categoria_id uuid references public.categorias_wallet(id) on delete restrict;

create index if not exists idx_movimientos_categoria_fecha
  on public.movimientos (categoria_id, fecha) where categoria_id is not null;

create or replace function public.movimientos_validar_categoria()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_cat    public.categorias_wallet%rowtype;
  v_padre  public.categorias_wallet%rowtype;
begin
  if new.categoria_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.categoria_id is not distinct from old.categoria_id then
    return new;
  end if;

  if new.tipo::text not in ('ingreso', 'egreso') then
    raise exception 'Las transferencias no llevan categoría.';
  end if;
  select * into v_cat from public.categorias_wallet where id = new.categoria_id;
  if not found then
    raise exception 'La categoría elegida no existe.';
  end if;
  if not v_cat.activo then
    raise exception 'La categoría elegida está archivada.';
  end if;
  if v_cat.padre_id is not null then
    select * into v_padre from public.categorias_wallet where id = v_cat.padre_id;
    if not v_padre.activo then
      raise exception 'La categoría elegida está archivada.';
    end if;
  end if;
  if v_cat.tipo <> 'AMBOS' and v_cat.tipo <> upper(new.tipo::text) then
    raise exception 'La categoría "%" no corresponde al tipo de este movimiento.', v_cat.nombre;
  end if;
  return new;
end;
$function$;

revoke execute on function public.movimientos_validar_categoria() from public, anon, authenticated;

drop trigger if exists trg_movimientos_validar_categoria on public.movimientos;
create trigger trg_movimientos_validar_categoria
  before insert or update of categoria_id on public.movimientos
  for each row
  when (new.categoria_id is not null)
  execute function public.movimientos_validar_categoria();

-- 4. RLS: deny-all para anon/authenticated (service_role bypassa RLS) -------------
alter table public.categorias_wallet enable row level security;

revoke all on public.categorias_wallet from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'categorias_wallet' and policyname = 'categorias_wallet_deny_anon'
  ) then
    create policy categorias_wallet_deny_anon
      on public.categorias_wallet for all to anon, authenticated using (false) with check (false);
  end if;
end $$;

commit;

-- Verificación (ejecutar a mano después):
--   select count(*) from public.categorias_wallet;                              -- 0 al inicio
--   select count(*) filter (where categoria_id is null) as sin_categoria,
--          count(*) filter (where categoria_id is not null) as con_categoria
--     from public.movimientos;                                                  -- todo "sin categoría"
--   select relrowsecurity from pg_class where oid = 'public.categorias_wallet'::regclass;  -- true

-- Recarga el esquema de PostgREST (columna categoria_id y tablas nuevas visibles para el backend sin reiniciar).
notify pgrst, 'reload schema';
