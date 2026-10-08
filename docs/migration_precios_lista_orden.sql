-- Orden manual de los materiales dentro de una lista de precios (arrastrar para reordenar).
-- Idempotente. NO aplicada todavía: hasta aplicarla, el backend usa el orden de alta.

alter table public.precios_lista
  add column if not exists orden integer not null default 0;

-- Backfill: conserva el orden actual (fecha de alta) solo en listas sin orden asignado.
with numerados as (
  select id,
         row_number() over (partition by lista_id order by created_at, id) - 1 as nuevo
  from public.precios_lista
  where lista_id in (
    select lista_id from public.precios_lista group by lista_id having max(orden) = 0
  )
)
update public.precios_lista p
set orden = n.nuevo
from numerados n
where p.id = n.id;

create index if not exists idx_precios_lista_orden
  on public.precios_lista (lista_id, orden);
