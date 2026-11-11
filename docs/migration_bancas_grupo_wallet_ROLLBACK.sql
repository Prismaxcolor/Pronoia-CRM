alter table public.bancas drop constraint if exists bancas_grupo_wallet_check;
alter table public.bancas drop column if exists grupo_wallet;
