-- =============================================================================
-- Costo de referencia editable por producto (USD/kg)
--
-- Por qué: el valor a costo del inventario salía solo del promedio de las facturas de compra, y
-- muchos productos no tienen factura. Julio puede fijar a mano un costo de referencia por producto;
-- si existe, manda sobre el promedio de facturas (fuente 'manual'); si no, se usa el promedio de
-- facturas (fuente 'facturas'); si no hay ninguno, el producto queda "sin costo".
--
-- Qué hace (idempotente: se puede ejecutar más de una vez sin efectos secundarios):
--   1. productos.costo_referencia_kg               numeric null, check (>= 0)
--   2. productos.costo_referencia_actualizado_en   timestamptz null
--   3. productos.costo_referencia_actualizado_por  uuid null (quién lo cambió; sin FK para no
--      bloquear el borrado de usuarios)
--   4. Función actualizar_costos_referencia(items jsonb, usuario uuid): guarda varios costos en UNA
--      transacción (todo o nada). Solo la puede ejecutar service_role (el backend); anon y
--      authenticated quedan sin acceso.
--
-- Seguridad: no cambia permisos ni RLS (productos ya tiene RLS y anon sin privilegios; las columnas
-- nuevas heredan eso). Solo el backend (service_role) lee y escribe, y solo con facturacion:ver /
-- facturacion:editar. Sin datos destructivos ni relleno: todo queda null hasta que Julio lo edite.
-- Cómo ensayar: pegar completo en el SQL Editor de una copia/branch (trae begin/commit; ante un
-- error no queda nada aplicado). El backend tolera que la migración aún no esté aplicada (el costo
-- sale solo de las facturas y el guardado responde que no está habilitado).
--
-- ROLLBACK (ejecutar manualmente si hace falta; pierde los costos de referencia cargados):
--   begin;
--     drop function if exists public.actualizar_costos_referencia(jsonb, uuid);
--     alter table public.productos drop constraint if exists productos_costo_referencia_kg_check;
--     alter table public.productos drop column if exists costo_referencia_actualizado_por;
--     alter table public.productos drop column if exists costo_referencia_actualizado_en;
--     alter table public.productos drop column if exists costo_referencia_kg;
--   commit;
-- =============================================================================

begin;

alter table public.productos add column if not exists costo_referencia_kg numeric;
alter table public.productos add column if not exists costo_referencia_actualizado_en timestamptz;
alter table public.productos add column if not exists costo_referencia_actualizado_por uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'productos_costo_referencia_kg_check'
       and conrelid = 'public.productos'::regclass
  ) then
    alter table public.productos
      add constraint productos_costo_referencia_kg_check
      check (costo_referencia_kg is null or costo_referencia_kg >= 0);
  end if;
end $$;

comment on column public.productos.costo_referencia_kg is
  'Costo de referencia en USD/kg fijado a mano. Si no es null manda sobre el promedio de facturas en el valor a costo del inventario.';
comment on column public.productos.costo_referencia_actualizado_en is
  'Cuándo se cambió por última vez costo_referencia_kg.';
comment on column public.productos.costo_referencia_actualizado_por is
  'Usuario (users.id) que cambió por última vez costo_referencia_kg.';

-- 4. Guardado en lote, atómico ------------------------------------------------
-- p_items: [{ "producto_id": "<uuid>", "costo": 1.25 | null }, ...] (costo null = quitar la referencia).
-- Si algún producto no existe se aborta todo (no queda nada aplicado).
create or replace function public.actualizar_costos_referencia(p_items jsonb, p_usuario uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  n integer;
begin
  with src as (
    select (e->>'producto_id')::uuid as id, nullif(e->>'costo', '')::numeric as costo
      from jsonb_array_elements(p_items) e
  )
  update public.productos p
     set costo_referencia_kg = src.costo,
         costo_referencia_actualizado_en = now(),
         costo_referencia_actualizado_por = p_usuario
    from src
   where p.id = src.id;
  get diagnostics n = row_count;
  if n <> jsonb_array_length(p_items) then
    raise exception 'producto_inexistente: se esperaban % productos y se actualizaron %', jsonb_array_length(p_items), n;
  end if;
  return n;
end;
$$;

revoke all on function public.actualizar_costos_referencia(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.actualizar_costos_referencia(jsonb, uuid) to service_role;

commit;
