-- Enlace de Telegram de los usuarios del sistema (public.users), igual que proveedores/clientes.
-- Permite avisos privados (p. ej. solicitudes de llave) a los superadmin.
-- Aditiva e idempotente. NO borra datos.
--
-- ROLLBACK (manual):
--   drop index if exists public.idx_users_telegram_chat_id;
--   alter table public.users drop column if exists telegram_chat_id, drop column if exists telegram_linked_at;
--   delete from public.telegram_link_tokens where entidad_tipo = 'usuario';
--   alter table public.telegram_link_tokens drop constraint if exists telegram_link_tokens_entidad_tipo_check;
--   alter table public.telegram_link_tokens add constraint telegram_link_tokens_entidad_tipo_check
--     check (entidad_tipo in ('proveedor', 'cliente'));

alter table public.users
  add column if not exists telegram_chat_id text,
  add column if not exists telegram_linked_at timestamptz;

-- Un mismo chat de Telegram no puede quedar enlazado a dos usuarios.
create unique index if not exists idx_users_telegram_chat_id
  on public.users (telegram_chat_id) where telegram_chat_id is not null;

-- Admitir 'usuario' en los tokens de enlace (constraint real: telegram_link_tokens_entidad_tipo_check).
alter table public.telegram_link_tokens drop constraint if exists telegram_link_tokens_entidad_tipo_check;
alter table public.telegram_link_tokens add constraint telegram_link_tokens_entidad_tipo_check
  check (entidad_tipo in ('proveedor', 'cliente', 'usuario'));
