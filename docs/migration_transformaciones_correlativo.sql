-- =============================================================================
-- Correlativo de transformaciones: TR-0001, TR-0002, ... (antes solo uuid).
--
-- Mismo patrón que facturas_compra.numero: columna bigint con secuencia. Las
-- funciones que insertan en `transformaciones` no cambian, porque `numero`
-- toma el valor por default.
--
-- CÓMO APLICAR: pegar en Supabase Studio → SQL Editor y ejecutar, con backup
-- previo. Las transformaciones existentes se numeran por orden de creación.
-- =============================================================================

create sequence if not exists public.transformaciones_numero_seq;

alter table public.transformaciones
  add column if not exists numero bigint;

-- Backfill: numera las transformaciones existentes en orden de creación.
update public.transformaciones t
set numero = o.rn
from (
  select id, row_number() over (order by created_at, id) as rn
  from public.transformaciones
  where numero is null
) o
where t.id = o.id;

-- Avanza la secuencia más allá del máximo ya asignado.
select setval(
  'public.transformaciones_numero_seq',
  coalesce((select max(numero) from public.transformaciones), 0) + 1,
  false
);

alter table public.transformaciones
  alter column numero set default nextval('public.transformaciones_numero_seq');

alter table public.transformaciones
  alter column numero set not null;

create unique index if not exists idx_transformaciones_numero
  on public.transformaciones (numero);
