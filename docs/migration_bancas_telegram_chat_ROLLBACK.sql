-- Rollback de migration_bancas_telegram_chat.sql (las bancas vuelven al grupo general de cajas).
alter table public.bancas drop constraint if exists bancas_telegram_chat_id_formato_check;
alter table public.bancas drop column if exists telegram_chat_id;
