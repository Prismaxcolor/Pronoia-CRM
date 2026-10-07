-- Comprobante (imagen) OPCIONAL de los movimientos de dinero.
-- movimientos.comprobantes guarda las URLs de las imágenes subidas vía
-- POST /api/uploads/comprobantes. Los pagos/cobros ya la usan; esta migración la
-- declara de forma idempotente (no cambia nada si la columna ya existe) para que el
-- formulario de "Nuevo movimiento" (cochinito) también pueda guardarla.
-- NO aplicada en producción: correrla en el SQL Editor de Supabase.

alter table public.movimientos
  add column if not exists comprobantes text[] not null default '{}';
