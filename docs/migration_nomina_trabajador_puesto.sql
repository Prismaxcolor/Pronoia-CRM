-- Nómina: puesto de trabajo (cargo laboral) del trabajador. Columna opcional, sin efecto sobre pagos ni nóminas.
-- ROLLBACK: docs/migration_nomina_trabajador_puesto_ROLLBACK.sql
begin;

alter table public.nomina_trabajadores
  add column if not exists puesto text;

alter table public.nomina_trabajadores
  drop constraint if exists nomina_trabajadores_puesto_largo;
alter table public.nomina_trabajadores
  add constraint nomina_trabajadores_puesto_largo check (puesto is null or char_length(puesto) <= 80);

comment on column public.nomina_trabajadores.puesto is
  'Puesto de trabajo del trabajador (p. ej. Operador de planta, Contador). Opcional.';

commit;

-- Que PostgREST vea de inmediato la columna nueva.
notify pgrst, 'reload schema';
