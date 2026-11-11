-- ROLLBACK de migration_terceros_imagen.sql
-- Quita las columnas. Los buckets "proveedores" y "clientes" NO se tocan: los usa también la galería de fotos
-- de cada tercero.

alter table public.proveedores
  drop column if exists imagen_url;

alter table public.clientes
  drop column if exists imagen_url;

notify pgrst, 'reload schema';
