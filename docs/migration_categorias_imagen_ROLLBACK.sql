-- ROLLBACK de migration_categorias_imagen.sql
-- Quita la columna. El bucket "categorias" NO se borra aquí (falla si tiene archivos): vaciarlo y borrarlo
-- desde el panel de Storage si hace falta.

alter table public.categorias_wallet
  drop column if exists imagen_url;

notify pgrst, 'reload schema';
