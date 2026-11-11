-- =============================================================================
-- ROLLBACK de docs/migration_mesa_cambio_comision_asiento.sql
--
-- * La categoría vuelve a llamarse "Comisión cambio de divisas" (si no hay ya otra con ese nombre en el mismo padre).
-- * Los asientos COMISION no se pueden borrar (los asientos no se borran, solo se anulan). Por eso:
--     - Si hay asientos COMISION VIGENTES, este rollback se niega a correr: anula antes esas transferencias desde Wallet
--       (se anula también su asiento) o decide qué hacer con ese saldo.
--     - Si solo quedan anulados, se conserva el tipo 'COMISION' en el CHECK (historial) y el resto se revierte.
-- * La vista cambistas_saldos vuelve a contar solo COBRO y NC en total_cobros.
-- * La RPC cobrar_transferencia_mesa_cambio vuelve a su versión anterior re-ejecutando
--   docs/migration_mesa_cambio_comision_movimiento.sql (CREATE OR REPLACE, idempotente). Ejecútalo DESPUÉS de este
--   archivo: así su paso 2 encuentra la categoría con el nombre viejo y no crea una duplicada.
-- =============================================================================

begin;

do $$
begin
  if exists (select 1 from public.cambista_asientos where tipo = 'COMISION' and not anulado) then
    raise exception 'Hay asientos de comisión de mesa de cambio vigentes: anula esas transferencias antes del rollback.';
  end if;
end $$;

do $$
declare
  v_id    uuid;
  v_padre uuid;
begin
  select id, padre_id into v_id, v_padre
    from public.categorias_wallet
   where translate(lower(btrim(nombre)), 'áéíóú', 'aeiou') = 'comision % por cambio de divisas'
   order by created_at
   limit 1;
  if v_id is not null and not exists (
    select 1 from public.categorias_wallet
     where coalesce(padre_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_padre, '00000000-0000-0000-0000-000000000000'::uuid)
       and translate(lower(btrim(nombre)), 'áéíóú', 'aeiou') = 'comision cambio de divisas'
  ) then
    update public.categorias_wallet set nombre = 'Comisión cambio de divisas' where id = v_id;
  end if;
end $$;

create or replace view public.cambistas_saldos
with (security_invoker = true) as
  select c.id as cambista_id,
         coalesce(sum(case when a.tipo in ('CARGO', 'ND') then a.monto_usd else 0 end), 0)::numeric(14,2) as total_cargos,
         coalesce(sum(case when a.tipo in ('COBRO', 'NC') then a.monto_usd else 0 end), 0)::numeric(14,2) as total_cobros,
         coalesce(sum(case when a.tipo in ('CARGO', 'ND') then a.monto_usd else -a.monto_usd end), 0)::numeric(14,2) as saldo,
         count(a.id)::int as asientos
    from public.cambistas c
    left join public.cambista_asientos a on a.cambista_id = c.id and not a.anulado
   group by c.id;

revoke all on public.cambistas_saldos from public, anon, authenticated;
grant select on public.cambistas_saldos to service_role;

alter table public.cambista_asientos drop constraint if exists cambista_asientos_comision_con_movimiento;

-- El CHECK del tipo solo se estrecha si no quedan asientos COMISION (ni siquiera anulados).
do $$
begin
  if not exists (select 1 from public.cambista_asientos where tipo = 'COMISION') then
    alter table public.cambista_asientos drop constraint if exists cambista_asientos_tipo_check;
    alter table public.cambista_asientos
      add constraint cambista_asientos_tipo_check check (tipo in ('CARGO', 'COBRO', 'NC', 'ND'));
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
