-- Proveedores y clientes: imagen opcional junto al nombre (proveedores.imagen_url, clientes.imagen_url).
--
-- Logo o foto de la empresa/persona; se muestra al lado del nombre en el listado y en la tarjeta del tercero
-- (en lugar de la inicial). Es distinta de la columna "fotos" (galería de fotos del tercero).
-- URL pública de los buckets de Storage "proveedores" y "clientes" (ya usados por POST /api/uploads/:tipo).
-- Aditiva e idempotente. NO se aplica sola. Sin default: los terceros existentes quedan sin imagen (NULL)
-- y la UI sigue mostrando la inicial. El backend tolera que la columna aún no exista (responde 409 al guardar una imagen).

alter table public.proveedores
  add column if not exists imagen_url text;

alter table public.clientes
  add column if not exists imagen_url text;

-- Buckets públicos (lectura pública, escritura solo con service role desde POST /api/uploads/:tipo).
-- Si ya existen (creados a mano o por migraciones anteriores), no hace nada.
insert into storage.buckets (id, name, public)
values ('proveedores', 'proveedores', true), ('clientes', 'clientes', true)
on conflict (id) do nothing;

-- Recarga el esquema de PostgREST (columnas visibles para el backend sin reiniciar).
notify pgrst, 'reload schema';
