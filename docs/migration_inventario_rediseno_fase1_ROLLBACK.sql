-- =============================================================================
-- ROLLBACK de migration_inventario_rediseno_fase1.sql
-- =============================================================================
-- ADVERTENCIA: borra los datos que se hayan cargado con las funciones nuevas
-- (merma tipificada, embalajes, precios estimados, clases elegidas, valores de
-- configuración). Los datos de inventario, transformaciones y lotes originales
-- no se tocan. El backend es tolerante: sin estos objetos, el resumen y los
-- endpoints nuevos responden vacío/409 y el flujo actual sigue igual.
--
-- Hacer una copia de lo que se quiera conservar antes de ejecutar:
--   select * from public.lote_embalajes;
--   select * from public.transformacion_merma_detalle;
--   select nombre, clase, precio_estimado_kg from public.lotes;
-- =============================================================================

begin;

drop function if exists public.anular_lote_embalaje(uuid, text, uuid);
drop function if exists public.marcar_lote_embalado(uuid, uuid, numeric, text, text, uuid);
drop function if exists public.registrar_merma_transformacion(uuid, jsonb);

drop table if exists public.lote_embalajes;
drop table if exists public.transformacion_merma_detalle;
drop table if exists public.configuracion_inventario;

alter table public.lotes drop constraint if exists lotes_precio_estimado_check;
alter table public.lotes drop constraint if exists lotes_clase_check;
alter table public.lotes drop column if exists precio_estimado_actualizado_por;
alter table public.lotes drop column if exists precio_estimado_actualizado_en;
alter table public.lotes drop column if exists precio_estimado_kg;
alter table public.lotes drop column if exists clase;

alter table public.productos drop column if exists vendible;

commit;
