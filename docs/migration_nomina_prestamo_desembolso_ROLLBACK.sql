-- =============================================================================
-- ROLLBACK de docs/migration_nomina_prestamo_desembolso.sql
--
-- Se niega a correr si hay desembolsos registrados (vigentes o anulados): borrar la tabla dejaría los egresos del Wallet sin
-- su préstamo y sin forma de anularlos juntos. Solo se puede revertir mientras no se haya registrado ningún pago de préstamo.
-- Restaura movimientos_nomina_proteger a la versión de migration_nomina_pago_wallet.sql.
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.nomina_prestamo_pagos') is not null and exists (select 1 from public.nomina_prestamo_pagos) then
    raise exception 'Hay pagos de préstamos registrados: no se puede revertir sin perder su historia.';
  end if;
end $$;

drop function if exists public.nomina_prestamo_pagar(uuid, jsonb, uuid);
drop function if exists public.nomina_prestamo_anular(uuid, text, uuid);

-- Guardián: versión original (solo pagos de nómina).
create or replace function public.movimientos_nomina_proteger()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if coalesce(current_setting('app.nomina_pago_rpc', true), '') = 'on' then
    return new;
  end if;
  if exists (select 1 from public.nomina_pagos p where p.movimiento_id in (old.id, coalesce(old.comision_de_id, old.id))) then
    raise exception 'Este movimiento es el pago de una nómina: se anula anulando la nómina (no se pueden cambiar su anulación, importes ni cuentas desde el Wallet).';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_nomina_prestamo_pagos_proteger on public.nomina_prestamo_pagos;
drop function if exists public.nomina_prestamo_pagos_proteger();
drop table if exists public.nomina_prestamo_pagos;

commit;

notify pgrst, 'reload schema';
