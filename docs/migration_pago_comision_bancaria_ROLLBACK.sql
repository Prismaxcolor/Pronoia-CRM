-- =============================================================================
-- ROLLBACK de migration_pago_comision_bancaria.sql.
--
-- Quita la RPC agregar_comision_bancaria_a_pago y deja anular_pago_cobro como estaba en
-- migration_editar_anular_transacciones.sql (sin el paso que anula la comisión del pago).
-- Los cargos de comisión ya creados QUEDAN como están (egresos vinculados con comision_de_id): el saldo de las
-- cuentas no cambia. Si hay pagos con comisión que se quieren anular, anúlalos ANTES de revertir: después el
-- guardián de comisiones (de Wallet) bloquearía su anulación. Hacer backup antes de ejecutar.
-- =============================================================================

begin;

drop function if exists public.agregar_comision_bancaria_a_pago(uuid, uuid);

create or replace function public.anular_pago_cobro(p_grupo_id uuid, p_motivo text, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_ctx     record;
  v_bancas  uuid[];
  v_ini     jsonb;
  v_n_mov   int := 0;
  v_n_apl   int := 0;
  v_total   numeric;
begin
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'El motivo de la anulacion es obligatorio.';
  end if;

  select * into v_ctx from public._grupo_pago_contexto(p_grupo_id);
  if v_ctx.anulado then
    raise exception 'Esta operacion ya fue anulada.';
  end if;

  -- Mismo orden de bloqueo que registrar_*: entidad -> bancas (por id) -> items.
  if v_ctx.es_proveedor then
    perform 1 from public.proveedores where id = v_ctx.entidad_id for update;
  else
    perform 1 from public.clientes where id = v_ctx.entidad_id for update;
  end if;

  select coalesce(array_agg(distinct banca_origen_id), '{}') into v_bancas
    from public.movimientos
   where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado;
  perform 1 from public.bancas where id = any(v_bancas) order by id for update;
  perform 1 from public.movimientos
   where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado for update;

  -- El adelanto/anticipo de esta operacion ya se uso para pagar otras facturas:
  -- anular dejaria esas facturas pagadas con un adelanto que ya no existe.
  if exists (select 1 from public.pago_aplicaciones a
              where a.tipo = 'adelanto' and a.item_id = p_grupo_id and not a.anulada and a.grupo_id <> p_grupo_id) then
    raise exception 'El adelanto/anticipo generado por esta operacion ya fue aplicado a facturas en otra operacion. Anula primero esa operacion y luego esta.';
  end if;

  -- Pago simple antiguo (sin detalle de facturas): no se sabe que factura revertir.
  if exists (select 1 from public.movimientos m
              where (m.grupo_id = p_grupo_id or (m.grupo_id is null and m.id = p_grupo_id))
                and not m.anulado and m.subtipo in ('pago', 'cobro'))
     and not exists (select 1 from public.pago_aplicaciones a where a.grupo_id = p_grupo_id and not a.anulada) then
    raise exception 'Este pago/cobro se registro con el formato antiguo, sin detalle de facturas, y no se puede revertir de forma segura. Consulta al administrador.';
  end if;

  v_ini := public._snapshot_saldos(v_bancas);
  v_n_apl := public._revertir_aplicaciones_grupo(v_ctx.es_proveedor, p_grupo_id);
  perform public._revertir_saldos_grupo(p_grupo_id);

  select coalesce(sum(coalesce(monto_usd, monto)), 0) into v_total
    from public.movimientos
   where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado;

  update public.movimientos
     set anulado = true, anulado_at = now(), anulado_por = p_usuario, anulado_motivo = btrim(p_motivo)
   where (grupo_id = p_grupo_id or (grupo_id is null and id = p_grupo_id)) and not anulado;
  get diagnostics v_n_mov = row_count;

  update public.cruces
     set anulado = true, anulado_at = now(), anulado_por = p_usuario, anulado_motivo = btrim(p_motivo)
   where grupo_id = p_grupo_id and not anulado;

  update public.pago_aplicaciones set anulada = true, anulada_at = now()
   where grupo_id = p_grupo_id and not anulada;

  perform public._verificar_saldos(v_ini);

  return jsonb_build_object(
    'grupoId', p_grupo_id, 'esProveedor', v_ctx.es_proveedor, 'entidadId', v_ctx.entidad_id,
    'movimientosAnulados', v_n_mov, 'aplicacionesRevertidas', v_n_apl, 'totalUsd', round(v_total, 2));
end;
$$;

revoke execute on function public.anular_pago_cobro(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.anular_pago_cobro(uuid, text, uuid) to service_role;

commit;

notify pgrst, 'reload schema';
