-- Wallet: imagen opcional por cuenta/caja (public.bancas.imagen_url).
--
-- Logo del banco o foto de la caja; se muestra en los selectores de cuenta (tarjetas con imagen,
-- como el selector de material en Pesaje). URL pública del bucket de Storage "bancas".
-- Aditiva e idempotente. NO se aplica sola. Sin default: las cuentas existentes quedan sin imagen (NULL)
-- y la UI sigue mostrando el color / la inicial. El backend tolera que la columna aún no exista.

alter table public.bancas
  add column if not exists imagen_url text;

-- Bucket público "bancas" (lectura pública, escritura solo con service role desde POST /api/uploads/bancas).
-- Si ya se creó a mano desde el panel de Supabase, no hace nada.
insert into storage.buckets (id, name, public)
values ('bancas', 'bancas', true)
on conflict (id) do nothing;

-- Recarga el esquema de PostgREST (columna imagen_url visible para el backend sin reiniciar).
notify pgrst, 'reload schema';
