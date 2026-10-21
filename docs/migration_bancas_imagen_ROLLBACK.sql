-- ROLLBACK de migration_bancas_imagen.sql
-- Quita la columna. El bucket "bancas" NO se borra aquí (falla si tiene archivos): vaciarlo y borrarlo
-- desde el panel de Storage si hace falta.

alter table public.bancas
  drop column if exists imagen_url;
