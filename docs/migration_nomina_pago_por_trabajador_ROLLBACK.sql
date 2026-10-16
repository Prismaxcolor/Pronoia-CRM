-- =============================================================================
-- ROLLBACK de docs/migration_nomina_pago_por_trabajador.sql
--
-- Se niega a correr si existe CUALQUIER pago por trabajador (linea_id no nulo), vigente o ya anulado: quitar la columna
-- borraría el vínculo entre el egreso del Wallet y el renglón, y la tabla nomina_pagos es inmutable. Solo se puede revertir
-- mientras no se haya usado el botón «Pagar» por trabajador.
-- =============================================================================

begin;

lock table public.nomina_pagos in share row exclusive mode;

do $$
declare
  v_usado boolean := false;
begin
  -- EXECUTE: en una segunda ejecución la columna ya no existe y plpgsql analizaría la consulta antes de correrla.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'nomina_pagos' and column_name = 'linea_id') then
    execute 'select exists (select 1 from public.nomina_pagos where linea_id is not null)' into v_usado;
  end if;
  if v_usado then
    raise exception 'Hay pagos por trabajador registrados: no se puede revertir sin perder su historia. Anula las nóminas y conserva el respaldo.';
  end if;
end $$;

drop trigger if exists trg_nomina_pagos_exclusividad on public.nomina_pagos;
drop function if exists public.nomina_pagos_exclusividad();
drop function if exists public.nomina_pagar_trabajador(uuid, uuid, jsonb, uuid);

drop index if exists public.uq_nomina_pagos_linea_moneda;
drop index if exists public.uq_nomina_pagos_nomina_moneda;
drop index if exists public.idx_nomina_pagos_linea;
alter table public.nomina_pagos drop column if exists linea_id;

-- Restaura unique (nomina_id, moneda_pago) (solo si no está ya).
do $$
begin
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.nomina_pagos'::regclass and c.contype = 'u' and c.conname = 'nomina_pagos_nomina_id_moneda_pago_key') then
    alter table public.nomina_pagos add constraint nomina_pagos_nomina_id_moneda_pago_key unique (nomina_id, moneda_pago);
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
