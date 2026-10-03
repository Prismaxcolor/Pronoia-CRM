-- Vehículos: placa, fotos y datos de identificación opcionales
-- (marca, modelo, color, conductor habitual).
--
-- - placa: la normaliza el backend (mayúsculas, sin espacios sobrantes). Única
--   solo entre vehículos ACTIVOS (índice parcial) y solo si no es null, para
--   tolerar los vehículos antiguos sin placa. Va un índice sobre upper() por
--   si alguien escribe directo en la BD sin pasar por el backend.
-- - fotos: URLs del bucket 'tickets' (mismo mecanismo que el resto del sistema).
-- - No hay funciones SQL nuevas, por lo tanto no aplican REVOKE EXECUTE.
-- - tickets_pesaje.vehiculo sigue siendo texto libre; no se toca.
--
-- IDEMPOTENTE. Transaccional.
--
-- ROLLBACK (solo si hace falta; borra los datos de placa/fotos cargados):
--   begin;
--   drop index if exists public.idx_vehiculos_placa_activa;
--   alter table public.vehiculos
--     drop column if exists fotos,
--     drop column if exists conductor,
--     drop column if exists color,
--     drop column if exists modelo,
--     drop column if exists marca,
--     drop column if exists placa;
--   commit;

begin;

alter table public.vehiculos
  add column if not exists placa     text,
  add column if not exists marca     text,
  add column if not exists modelo    text,
  add column if not exists color     text,
  add column if not exists conductor text,
  add column if not exists fotos     text[] not null default '{}';

create unique index if not exists idx_vehiculos_placa_activa
  on public.vehiculos (upper(btrim(placa)))
  where activo and placa is not null;

commit;
