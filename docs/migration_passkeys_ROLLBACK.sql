-- Rollback de migration_passkeys.sql. Elimina todas las passkeys registradas (los usuarios
-- seguirán entrando con email y contraseña).
begin;
drop table if exists public.passkey_challenges;
drop table if exists public.passkeys;
commit;
