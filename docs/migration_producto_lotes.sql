-- Lotes anclados a productos (no a categorías).
--
-- Un producto puede tener 0..N "lotes posibles" (tabla puente producto_lotes).
-- Un producto sin filas no pertenece a ningún lote. No toca stock, ni
-- composición de lotes, ni tickets/tomas existentes: es solo un catálogo de
-- anclajes que usan (a) el formulario de productos, (b) el selector de lote en
-- el pesaje (prioriza los anclados) y (c) la toma física por categoría (solo
-- ofrece categorías sin productos anclados).
--
-- Idempotente. Todo en una transacción.
--
-- ROLLBACK (si hay que revertir; no afecta ningún otro dato):
--   begin;
--   drop function if exists public.reemplazar_producto_lotes(uuid, uuid[]);
--   drop table if exists public.producto_lotes;
--   commit;
--
-- BACKFILL inicial: se derivan SOLO los pares (producto, lote) que ya ocurrieron
-- de verdad: líneas de detalle_tickets_pesaje con destino_tipo = 'lote'. No se
-- infiere nada por categoría. Si se prefiere arrancar vacío, comentar el bloque
-- "Backfill" y aplicar el resto.

begin;

create table if not exists public.producto_lotes (
  producto_id uuid not null references public.productos(id) on delete cascade,
  lote_id     uuid not null references public.lotes(id)     on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (producto_id, lote_id)
);

create index if not exists idx_producto_lotes_lote on public.producto_lotes (lote_id);

-- Solo el backend (service role) toca esta tabla; anon denegado.
alter table public.producto_lotes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'producto_lotes'
      and policyname = 'producto_lotes_deny_anon'
  ) then
    create policy producto_lotes_deny_anon
      on public.producto_lotes for all to anon using (false) with check (false);
  end if;
end $$;

-- Reemplaza de forma atómica el conjunto de lotes posibles de un producto.
create or replace function public.reemplazar_producto_lotes(
  p_producto_id uuid,
  p_lote_ids uuid[]
) returns void
language plpgsql
as $$
declare
  v_ids uuid[] := coalesce(
    (select array_agg(distinct x) from unnest(p_lote_ids) as x where x is not null),
    '{}'::uuid[]
  );
begin
  if not exists (select 1 from public.productos where id = p_producto_id) then
    raise exception 'Producto no encontrado.';
  end if;

  if exists (
    select 1 from unnest(v_ids) as x where not exists (select 1 from public.lotes l where l.id = x)
  ) then
    raise exception 'Algún lote elegido no existe.';
  end if;

  delete from public.producto_lotes
   where producto_id = p_producto_id and not (lote_id = any (v_ids));

  insert into public.producto_lotes (producto_id, lote_id)
  select p_producto_id, x from unnest(v_ids) as x
  on conflict do nothing;
end;
$$;

revoke execute on function public.reemplazar_producto_lotes(uuid, uuid[]) from public, anon, authenticated;

-- Backfill: pares producto-lote que ya se pesaron hacia un lote (solo lotes activos).
insert into public.producto_lotes (producto_id, lote_id)
select distinct d.producto_id, d.lote_id
  from public.detalle_tickets_pesaje d
  join public.lotes l on l.id = d.lote_id and l.activo
  join public.productos p on p.id = d.producto_id
 where d.destino_tipo = 'lote'
   and d.lote_id is not null
   and d.producto_id is not null
on conflict do nothing;

commit;
