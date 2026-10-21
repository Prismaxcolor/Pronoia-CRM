-- Wallet: grupo de Telegram por banca/caja (bancas.telegram_chat_id).
--
-- A este chat se envía el comprobante/aviso de los movimientos de esa banca. Si es NULL se usa
-- el grupo general de cajas (TELEGRAM_CAJAS_CHAT_ID en configuracion_secreta / entorno).
-- Aditiva e idempotente. NO se aplica sola. El backend tolera que aún no exista la columna.
-- Formato: id numérico de Telegram (los grupos son negativos, p. ej. -1001234567890).

alter table public.bancas
  add column if not exists telegram_chat_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bancas_telegram_chat_id_formato_check' and conrelid = 'public.bancas'::regclass
  ) then
    alter table public.bancas
      add constraint bancas_telegram_chat_id_formato_check
      check (telegram_chat_id is null or telegram_chat_id ~ '^-?[0-9]{5,20}$');
  end if;
end $$;
