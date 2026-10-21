-- ROLLBACK de docs/migration_pagos_pasos_pendientes.sql
-- Antes: aplicar docs/migration_idempotencia_pagos_cobros_ROLLBACK.sql (sus funciones usan esta tabla).
-- Se pierde el registro de pasos pendientes; revisar antes que no haya filas sin resolver:
--   select * from public.pagos_pasos_pendientes where resuelto_at is null;
begin;

drop table if exists public.pagos_pasos_pendientes;

commit;
