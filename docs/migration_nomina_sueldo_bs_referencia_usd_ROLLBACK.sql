-- =============================================================================
-- ROLLBACK de docs/migration_nomina_sueldo_bs_referencia_usd.sql
--
-- Quita la columna nomina_lineas.sueldo_bs_en_usd y los comentarios. NO deshace el cambio de significado del «sueldo en Bs»
-- (ese vive en el código: revierte también el despliegue del backend/frontend de esa tanda). Se niega a correr si hay
-- renglones de nóminas NO borrador con sueldo en Bs calculados con la lectura nueva (nominas cerradas después del cambio),
-- porque sin la columna ya no se podría distinguir en qué unidad estaba su monto_base_bs.
-- =============================================================================

begin;

do $$
declare
  v_usado boolean;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'nomina_lineas' and column_name = 'sueldo_bs_en_usd') then
    -- EXECUTE: la columna puede no existir en una segunda ejecución y plpgsql analiza la consulta antes de correrla.
    execute 'select exists (select 1 from public.nomina_lineas l join public.nominas n on n.id = l.nomina_id
                             where l.monto_base_bs > 0 and n.estado <> ''BORRADOR'' and l.sueldo_bs_en_usd)' into v_usado;
    if v_usado then
      raise exception 'Hay nóminas cerradas con sueldo en Bs de referencia en USD: sin la columna no se sabría su unidad. El rollback no es posible.';
    end if;
  end if;
end $$;

alter table public.nomina_lineas drop column if exists sueldo_bs_en_usd;
comment on column public.nomina_trabajadores.pago_diario_bs is null;
comment on column public.nomina_lineas.monto_base_bs is null;

commit;

notify pgrst, 'reload schema';
