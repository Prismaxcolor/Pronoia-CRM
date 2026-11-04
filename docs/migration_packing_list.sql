-- =============================================================================
-- Packing list de exportación
-- =============================================================================
-- MIGRACIÓN ADITIVA E IDEMPOTENTE, en una sola transacción. No toca tablas existentes.
-- Rollback completo: docs/migration_packing_list_ROLLBACK.sql. NO aplicada todavía: hasta
-- aplicarla, el backend responde 409 ("falta aplicar migration_packing_list.sql").
--
-- Qué crea:
--   1. packing_list_empresas   dirección/teléfono/correo de la empresa que encabeza el documento,
--                              una fila por idioma ('es' = Venezuela, 'en' = EE.UU.). Editable desde
--                              la app. La fila 'en' se siembra con el dato del ejemplo real; la 'es'
--                              queda VACÍA a propósito (no se inventa la dirección de Venezuela).
--   2. packing_lists           cabecera: contenedor, fecha, tipo de embalaje, si es PCB (solo entonces
--                              se muestran lote y color), descripción y observaciones en ES y EN, y
--                              una referencia opcional (tipo + id) a un ticket/factura a definir.
--   3. packing_list_items      una fila por big bag/paleta/paquete: lote y color (solo PCB), peso
--                              bruto, peso de la paleta (tara) y peso neto CALCULADO (bruto - tara).
--   4. guardar_packing_list()  crea o actualiza cabecera + ítems en UNA transacción (reemplaza los
--                              ítems), para no dejar un documento a medias.
--
-- Seguridad: RLS activado SIN políticas y REVOKE a anon/authenticated (solo service_role, el backend).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. packing_list_empresas
-- ---------------------------------------------------------------------------
create table if not exists public.packing_list_empresas (
  idioma           text primary key check (idioma in ('es', 'en')),
  nombre           text,
  direccion        text,
  telefono         text,
  email            text,
  actualizado_en   timestamptz not null default now(),
  actualizado_por  uuid references public.users(id) on delete set null
);

alter table public.packing_list_empresas enable row level security;
revoke all on table public.packing_list_empresas from public, anon, authenticated;
grant select, insert, update, delete on table public.packing_list_empresas to service_role;

-- Valor del packing list real (CONT 06). La dirección de Venezuela NO se conoce: la fila 'es' va vacía.
insert into public.packing_list_empresas (idioma, direccion, telefono, email) values
  ('en', E'1817 NE 24 ST, LIGHTHOUSE POINT, FLORIDA 33064\nMIAMI - EEUU', '+1 954-3971896', 'cubaswork@gmail.com'),
  ('es', null, null, null)
on conflict (idioma) do nothing;

-- ---------------------------------------------------------------------------
-- 2. packing_lists
-- ---------------------------------------------------------------------------
create table if not exists public.packing_lists (
  id               uuid primary key default gen_random_uuid(),
  contenedor       text not null check (length(btrim(contenedor)) between 1 and 60),
  fecha            date not null default current_date,
  tipo_embalaje    text not null default 'big_bag' check (tipo_embalaje in ('big_bag', 'paleta', 'paquete')),
  es_pcb           boolean not null default true,
  descripcion_es   text check (descripcion_es is null or length(descripcion_es) <= 200),
  descripcion_en   text check (descripcion_en is null or length(descripcion_en) <= 200),
  observaciones_es text check (observaciones_es is null or length(observaciones_es) <= 1000),
  observaciones_en text check (observaciones_en is null or length(observaciones_en) <= 1000),
  -- Vínculo opcional a un ticket/factura (a definir con el dueño). Ambos o ninguno.
  referencia_tipo  text check (referencia_tipo is null or referencia_tipo in ('ticket_pesaje', 'factura_venta')),
  referencia_id    uuid,
  creado_por       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint packing_lists_referencia_completa check ((referencia_tipo is null) = (referencia_id is null))
);

alter table public.packing_lists enable row level security;
revoke all on table public.packing_lists from public, anon, authenticated;
grant select, insert, update, delete on table public.packing_lists to service_role;

create index if not exists idx_packing_lists_fecha on public.packing_lists (fecha desc, created_at desc);
create index if not exists idx_packing_lists_referencia on public.packing_lists (referencia_tipo, referencia_id)
  where referencia_id is not null;

-- ---------------------------------------------------------------------------
-- 3. packing_list_items
-- ---------------------------------------------------------------------------
create table if not exists public.packing_list_items (
  id               uuid primary key default gen_random_uuid(),
  packing_list_id  uuid not null references public.packing_lists(id) on delete cascade,
  orden            integer not null check (orden >= 1),
  numero           integer not null check (numero >= 1),       -- n.º de big bag / paleta / paquete
  numero_paleta    integer check (numero_paleta is null or numero_paleta >= 1), -- n.º de paleta (reinicia por lote)
  lote             text check (lote is null or length(btrim(lote)) between 1 and 40),  -- solo PCB
  color            text check (color is null or length(btrim(color)) between 1 and 40), -- solo PCB
  peso_bruto       numeric(12, 2) not null check (peso_bruto >= 0 and peso_bruto < 10000000),
  peso_paleta      numeric(12, 2) not null default 0 check (peso_paleta >= 0),
  peso_neto        numeric(12, 2) generated always as (peso_bruto - peso_paleta) stored,
  constraint packing_list_items_tara_menor_bruto check (peso_paleta <= peso_bruto),
  constraint packing_list_items_orden_unico unique (packing_list_id, orden)
);

alter table public.packing_list_items enable row level security;
revoke all on table public.packing_list_items from public, anon, authenticated;
grant select, insert, update, delete on table public.packing_list_items to service_role;

-- ---------------------------------------------------------------------------
-- 4. guardar_packing_list
-- ---------------------------------------------------------------------------
-- p_id null = crear. p_cabecera: { contenedor, fecha, tipo_embalaje, es_pcb, descripcion_es,
-- descripcion_en, observaciones_es, observaciones_en, referencia_tipo, referencia_id }.
-- p_items: [{ numero, numero_paleta, lote, color, peso_bruto, peso_paleta }, ...] en el orden deseado.
-- Reemplaza todos los ítems. Con el lock de la cabecera, dos guardados simultáneos no se mezclan.
create or replace function public.guardar_packing_list(
  p_id        uuid,
  p_cabecera  jsonb,
  p_items     jsonb,
  p_usuario   uuid
) returns uuid
language plpgsql
set search_path = public
as $function$
declare
  v_id uuid;
begin
  if p_cabecera is null or jsonb_typeof(p_cabecera) <> 'object' then
    raise exception 'Faltan los datos del packing list.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'La lista de paletas es inválida.';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'Un packing list admite como máximo 500 paletas.';
  end if;

  if p_id is null then
    insert into public.packing_lists (
      contenedor, fecha, tipo_embalaje, es_pcb, descripcion_es, descripcion_en,
      observaciones_es, observaciones_en, referencia_tipo, referencia_id, creado_por
    ) values (
      p_cabecera->>'contenedor',
      coalesce(nullif(p_cabecera->>'fecha', '')::date, current_date),
      coalesce(nullif(p_cabecera->>'tipo_embalaje', ''), 'big_bag'),
      coalesce((p_cabecera->>'es_pcb')::boolean, true),
      nullif(btrim(p_cabecera->>'descripcion_es'), ''),
      nullif(btrim(p_cabecera->>'descripcion_en'), ''),
      nullif(btrim(p_cabecera->>'observaciones_es'), ''),
      nullif(btrim(p_cabecera->>'observaciones_en'), ''),
      nullif(p_cabecera->>'referencia_tipo', ''),
      nullif(p_cabecera->>'referencia_id', '')::uuid,
      p_usuario
    ) returning id into v_id;
  else
    select id into v_id from public.packing_lists where id = p_id for update;
    if v_id is null then
      raise exception 'Packing list no encontrado.';
    end if;
    update public.packing_lists set
      contenedor       = p_cabecera->>'contenedor',
      fecha            = coalesce(nullif(p_cabecera->>'fecha', '')::date, fecha),
      tipo_embalaje    = coalesce(nullif(p_cabecera->>'tipo_embalaje', ''), tipo_embalaje),
      es_pcb           = coalesce((p_cabecera->>'es_pcb')::boolean, es_pcb),
      descripcion_es   = nullif(btrim(p_cabecera->>'descripcion_es'), ''),
      descripcion_en   = nullif(btrim(p_cabecera->>'descripcion_en'), ''),
      observaciones_es = nullif(btrim(p_cabecera->>'observaciones_es'), ''),
      observaciones_en = nullif(btrim(p_cabecera->>'observaciones_en'), ''),
      referencia_tipo  = nullif(p_cabecera->>'referencia_tipo', ''),
      referencia_id    = nullif(p_cabecera->>'referencia_id', '')::uuid,
      updated_at       = now()
    where id = v_id;
    delete from public.packing_list_items where packing_list_id = v_id;
  end if;

  insert into public.packing_list_items (
    packing_list_id, orden, numero, numero_paleta, lote, color, peso_bruto, peso_paleta
  )
  select
    v_id,
    e.ord::integer,
    (e.item->>'numero')::integer,
    nullif(e.item->>'numero_paleta', '')::integer,
    nullif(btrim(e.item->>'lote'), ''),
    nullif(btrim(e.item->>'color'), ''),
    (e.item->>'peso_bruto')::numeric,
    coalesce(nullif(e.item->>'peso_paleta', '')::numeric, 0)
  from jsonb_array_elements(p_items) with ordinality as e(item, ord);

  return v_id;
end;
$function$;

revoke execute on function public.guardar_packing_list(uuid, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.guardar_packing_list(uuid, jsonb, jsonb, uuid) to service_role;

commit;
