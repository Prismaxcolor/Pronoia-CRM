-- =============================================================================
-- ROLLBACK de docs/migration_nomina_pago_wallet.sql
--
-- Se niega a correr si hay nóminas pagadas con egresos vigentes en el Wallet: borrar el vínculo dejaría esos egresos
-- sin su nómina y sin forma de anularlos juntos. Anula antes esas nóminas (la anulación devuelve el dinero a las cuentas).
-- Los egresos ya anulados del Wallet se conservan (nunca se borra dinero); solo desaparece el vínculo nomina_pagos.
--
-- Restaura nomina_anular a la versión de migration_nomina.sql (sin el bloque de Wallet).
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.nomina_pagos') is not null and exists (
    select 1 from public.nomina_pagos p join public.movimientos m on m.id = p.movimiento_id where not m.anulado
  ) then
    raise exception 'Hay nóminas pagadas con egresos vigentes en el Wallet: anula esas nóminas antes de revertir.';
  end if;
end $$;

drop trigger if exists trg_movimientos_nomina_proteger on public.movimientos;
drop function if exists public.movimientos_nomina_proteger();
drop function if exists public.nomina_pagar(uuid, jsonb, uuid);

-- nomina_anular: versión original de migration_nomina.sql.
create or replace function public.nomina_anular(p_nomina_id uuid, p_motivo text, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_n public.nominas%rowtype;
  v_m record;
begin
  select * into v_n from public.nominas where id = p_nomina_id for update;
  if not found then
    raise exception 'Nómina no encontrada.' using errcode = 'P0002';
  end if;
  if v_n.estado = 'ANULADA' then
    return jsonb_build_object('yaAnulada', true);
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'El motivo de la anulación es obligatorio.';
  end if;

  if v_n.estado = 'CERRADA' then
    perform set_config('nomina.ledger', '1', true);
    for v_m in
      select m.prestamo_id, m.monto_usd from public.nomina_prestamo_movimientos m
       where m.nomina_id = v_n.id and m.tipo = 'CUOTA'
         and not exists (select 1 from public.nomina_prestamo_movimientos r
                          where r.nomina_id = m.nomina_id and r.prestamo_id = m.prestamo_id and r.tipo = 'REVERSA')
       order by m.prestamo_id
    loop
      update public.nomina_prestamos
         set saldo_usd = saldo_usd + v_m.monto_usd,
             estado = case when estado = 'PAGADO' then 'ACTIVO' else estado end,
             updated_at = now()
       where id = v_m.prestamo_id and estado <> 'ANULADO';
      insert into public.nomina_prestamo_movimientos (prestamo_id, nomina_id, tipo, monto_usd)
      values (v_m.prestamo_id, v_n.id, 'REVERSA', v_m.monto_usd);
    end loop;
  end if;

  update public.nominas
     set estado = 'ANULADA', anulada_motivo = btrim(p_motivo), anulada_at = now(), anulada_por = p_usuario, updated_at = now()
   where id = v_n.id;
  return jsonb_build_object('yaAnulada', false);
end;
$function$;

revoke execute on function public.nomina_anular(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.nomina_anular(uuid, text, uuid) to service_role;

drop table if exists public.nomina_pagos;
drop function if exists public.nomina_pagos_proteger();

commit;

notify pgrst, 'reload schema';
