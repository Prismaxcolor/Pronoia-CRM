-- Notas de crédito/débito: categoría opcional (notas_ajuste_proveedor.categoria_id y notas_ajuste_cliente.categoria_id).
--
-- La categoría se guarda y se muestra en la nota (estado de cuenta, detalle, PDF/comprobante). NO entra a los
-- reportes del Wallet: las notas no son dinero real. Una nota no tiene "tipo de movimiento", así que admite cualquier
-- categoría activa (raíz o subcategoría) de cualquier tipo; el backend valida que exista y esté activa (y su padre).
-- Aditiva e idempotente. NO se aplica sola. Requiere docs/migration_wallet_categorias.sql (tabla categorias_wallet).
-- Sin default: las notas existentes quedan sin categoría (NULL). No toca RLS (ya activo y deny-all en ambas tablas).
-- El backend tolera que las columnas aún no existan (solo falla si se intenta guardar una categoría).

alter table public.notas_ajuste_proveedor
  add column if not exists categoria_id uuid references public.categorias_wallet(id) on delete restrict;

alter table public.notas_ajuste_cliente
  add column if not exists categoria_id uuid references public.categorias_wallet(id) on delete restrict;

create index if not exists idx_notas_ajuste_proveedor_categoria
  on public.notas_ajuste_proveedor (categoria_id) where categoria_id is not null;

create index if not exists idx_notas_ajuste_cliente_categoria
  on public.notas_ajuste_cliente (categoria_id) where categoria_id is not null;

-- Recarga el esquema de PostgREST (columnas visibles para el backend sin reiniciar).
notify pgrst, 'reload schema';
