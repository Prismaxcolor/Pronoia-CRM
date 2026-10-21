-- =============================================================================
-- Valoración de transformaciones (ancla opcional a factura de compra).
--
-- 100% ADITIVA: solo agrega columnas nullable. No toca datos ni funciones
-- existentes (crear/completar_transformacion* siguen igual).
--
-- ROLLBACK (manual, solo si hiciera falta; pierde los precios guardados):
--   alter table public.transformaciones drop column if exists factura_compra_id;
--   alter table public.transformaciones drop column if exists costo_unitario;
--   alter table public.transformacion_salida_detalle drop column if exists precio_unitario;
--
-- CÓMO APLICAR: Supabase Studio → SQL Editor, con backup previo. Es
-- idempotente. Hasta que se aplique, el backend tolera la ausencia de estas
-- columnas al leer (devuelve la valoración en null) y PATCH /valoracion
-- responde 409 indicando que falta aplicar la migración.
-- =============================================================================

-- Factura de compra a la que se ancla la transformación (opcional). Sin FK
-- en cascada: borrar una factura no debe borrar transformaciones.
alter table public.transformaciones
  add column if not exists factura_compra_id uuid
  references public.facturas_compra(id) on delete set null;

-- Precio de compra por kg del material de entrada (editable por el usuario;
-- se precarga desde la factura anclada pero puede diferir).
alter table public.transformaciones
  add column if not exists costo_unitario numeric
  check (costo_unitario is null or costo_unitario >= 0);

-- Precio por kg asignado a cada salida (editable).
alter table public.transformacion_salida_detalle
  add column if not exists precio_unitario numeric
  check (precio_unitario is null or precio_unitario >= 0);

create index if not exists idx_transformaciones_factura_compra
  on public.transformaciones (factura_compra_id)
  where factura_compra_id is not null;

-- -----------------------------------------------------------------------------
-- Guardado atómico de la valoración: cabecera + precios de salidas en UNA
-- transacción. Semántica: p_set_factura / p_set_costo = false significa
-- "no tocar" ese campo (ausente); true con valor NULL significa "borrar".
-- De p_salidas solo se actualizan las salidas listadas (formato
-- [{"id": uuid, "precioUnitario": numeric|null}]); si alguna no pertenece a
-- la transformación se aborta todo con SALIDA_AJENA.
-- ROLLBACK: drop function if exists public.guardar_valoracion_transformacion(uuid, uuid, numeric, jsonb, boolean, boolean);
-- -----------------------------------------------------------------------------
create or replace function public.guardar_valoracion_transformacion(
  p_id                uuid,
  p_factura_compra_id uuid,
  p_costo_unitario    numeric,
  p_salidas           jsonb,
  p_set_factura       boolean default true,
  p_set_costo         boolean default true
) returns void
language plpgsql
as $$
declare
  v_salidas jsonb := coalesce(p_salidas, '[]'::jsonb);
begin
  if not exists (select 1 from public.transformaciones where id = p_id) then
    raise exception 'TRANSFORMACION_NO_ENCONTRADA';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_salidas) as x(id uuid, "precioUnitario" numeric)
    where not exists (
      select 1 from public.transformacion_salida_detalle d
      where d.id = x.id and d.transformacion_id = p_id
    )
  ) then
    raise exception 'SALIDA_AJENA';
  end if;

  update public.transformaciones
  set factura_compra_id = case when p_set_factura then p_factura_compra_id else factura_compra_id end,
      costo_unitario    = case when p_set_costo    then p_costo_unitario    else costo_unitario    end
  where id = p_id;

  update public.transformacion_salida_detalle d
  set precio_unitario = x."precioUnitario"
  from jsonb_to_recordset(v_salidas) as x(id uuid, "precioUnitario" numeric)
  where d.id = x.id and d.transformacion_id = p_id;
end;
$$;

revoke execute on function public.guardar_valoracion_transformacion(uuid, uuid, numeric, jsonb, boolean, boolean)
  from public, anon, authenticated;
