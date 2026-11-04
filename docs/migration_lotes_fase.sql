-- =============================================================================
-- Rediseño de /inventario: lotes.fase (etapa del PCB codificada en el lote)
-- =============================================================================
-- MIGRACION ADITIVA E IDEMPOTENTE, en una sola transaccion. No modifica ni borra datos ni toca
-- ningun calculo de stock. Requiere migration_inventario_rediseno_fase1.sql (columna lotes.clase).
--
-- Que crea:
--   lotes.fase  text null  'por_procesar' | 'procesado'
--     Solo tiene sentido en lotes de clase 'trabajo':
--       por_procesar: LOTE MPP (mixto por procesar), BGPP (bajo grado por procesar), PCPP (PC por procesar)
--       procesado:    BGYP (bajo grado ya procesado), PCYP (PC ya procesado)
--     Recorrido de las tarjetas: por_procesar -> procesado -> Lote 1/2/3 (exportacion) en saca -> embalado.
--   El relleno inicial solo toca lotes con fase NULL y clase 'trabajo' y solo por nombre exacto
--   (sin pisar valores ya definidos: re-ejecutar la migracion no cambia lo elegido a mano).
--
-- Seguridad: no crea tablas ni funciones. En produccion lotes ya tiene REVOKE a anon/authenticated
-- (RLS aun sin activar): se activa RLS sin politicas (el backend usa service_role, que la omite) y se
-- repite el REVOKE/GRANT de forma idempotente. Ningun acceso existente cambia.
--
-- ROLLBACK (documentado, no automatico):
--   begin;
--     alter table public.lotes drop constraint if exists lotes_fase_check;
--     alter table public.lotes drop column if exists fase;
--   commit;
-- =============================================================================

begin;

alter table public.lotes add column if not exists fase text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lotes'::regclass and conname = 'lotes_fase_check'
  ) then
    alter table public.lotes
      add constraint lotes_fase_check check (fase is null or fase in ('por_procesar', 'procesado'));
  end if;
end $$;

comment on column public.lotes.fase is
  'Fase de un lote de trabajo: por_procesar (MPP, BGPP, PCPP) o procesado (BGYP, PCYP). NULL = sin definir.';

-- Relleno inicial: solo lotes de trabajo sin fase, por nombre exacto (sin distinguir mayusculas).
update public.lotes
   set fase = 'por_procesar'
 where fase is null and clase = 'trabajo'
   and upper(btrim(nombre)) in ('LOTE MPP', 'MPP', 'BGPP', 'PCPP');

update public.lotes
   set fase = 'procesado'
 where fase is null and clase = 'trabajo'
   and upper(btrim(nombre)) in ('BGYP', 'PCYP');

alter table public.lotes enable row level security;
revoke all on table public.lotes from public, anon, authenticated;
grant select, insert, update, delete on table public.lotes to service_role;

commit;
