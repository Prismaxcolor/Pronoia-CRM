-- Wallet: imagen opcional por categoría/subcategoría (public.categorias_wallet.imagen_url).
--
-- Logo o imagen de la categoría; se muestra junto al nombre (etiqueta, lista de categorías, tabla de movimientos
-- y selector de tarjetas). Es un complemento: el nombre y el color se conservan. URL pública del bucket de Storage "categorias".
-- Aditiva e idempotente. NO se aplica sola. Sin default: las categorías existentes quedan sin imagen (NULL)
-- y la UI sigue mostrando el color / la inicial. El backend tolera que la columna aún no exista.

alter table public.categorias_wallet
  add column if not exists imagen_url text;

-- Bucket público "categorias" (lectura pública, escritura solo con service role desde POST /api/uploads/categorias).
-- Límite de 6 MB y solo JPEG/PNG/WebP (nunca SVG). Si el bucket ya existe (p. ej. creado a mano desde el panel de
-- Supabase), se le aplican estos límites.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('categorias', 'categorias', true, 6291456, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Recarga el esquema de PostgREST (columna imagen_url visible para el backend sin reiniciar).
notify pgrst, 'reload schema';
