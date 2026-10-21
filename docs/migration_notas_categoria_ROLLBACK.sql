-- ROLLBACK de migration_notas_categoria.sql
-- Quita las columnas (y con ellas sus índices). Se pierde la categoría guardada en las notas.

alter table public.notas_ajuste_proveedor
  drop column if exists categoria_id;

alter table public.notas_ajuste_cliente
  drop column if exists categoria_id;

notify pgrst, 'reload schema';
