-- Wallet nueva: grupo de la cuenta (public.bancas.grupo_wallet).
-- Aditiva e idempotente. Sin default: las cuentas existentes quedan en NULL y el frontend
-- les deduce el grupo desde el tipo (efectivo -> efectivo, bancos -> corriente, exchange -> general).
-- El backend tolera que esta migración aún no esté aplicada (degrada a "sin grupo").

alter table public.bancas
  add column if not exists grupo_wallet text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bancas_grupo_wallet_check' and conrelid = 'public.bancas'::regclass
  ) then
    alter table public.bancas
      add constraint bancas_grupo_wallet_check
      check (grupo_wallet is null or grupo_wallet in ('efectivo','corriente','ahorros','inversiones','general'));
  end if;
end $$;

-- ROLLBACK (manual): ver migration_bancas_grupo_wallet_ROLLBACK.sql
