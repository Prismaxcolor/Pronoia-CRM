-- =============================================================================
-- Transformaciones: observación al completar
-- =============================================================================
-- Idempotente, una transacción. NO aplicada todavía.
-- Rollback: alter table public.transformaciones drop column if exists observacion_cierre;
--
-- Qué hace:
--   transformaciones.observacion_cierre text NULL (máx. 1000 caracteres): texto libre que el operador puede
--   escribir al completar la transformación (ferroso, PCB o mixta). Se muestra en el detalle.
--   No toca las funciones completar_*: el backend la guarda con un UPDATE tras completar con éxito.
-- Despliegue: backend nuevo sin esta migración => completar funciona igual; si el usuario escribe una observación
-- se completa y se avisa que la observación no se pudo guardar.
-- =============================================================================

begin;

alter table public.transformaciones
  add column if not exists observacion_cierre text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transformaciones_observacion_cierre_check' and conrelid = 'public.transformaciones'::regclass) then
    alter table public.transformaciones
      add constraint transformaciones_observacion_cierre_check
      check (observacion_cierre is null or length(observacion_cierre) <= 1000);
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
