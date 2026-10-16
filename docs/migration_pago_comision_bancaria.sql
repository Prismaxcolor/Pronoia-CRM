-- =============================================================================
-- Pagos a proveedor: comisión bancaria (0.3%, mínimo 14 Bs) cuando se paga desde una cuenta en Bs.
-- Es la MISMA comisión que ya existe en Wallet (docs/migration_wallet_comision_bancaria.sql, diseño en
-- docs/DISENO_wallet_comision_equivalente.md): mismo porcentaje, mismo mínimo y mismo vínculo
-- (movimientos.comision_bancaria en el principal, movimientos.comision_de_id en el cargo).
--
-- Qué hace:
--  1. RPC agregar_comision_bancaria_a_pago(p_movimiento_id, p_usuario): después de registrar un pago o adelanto a
--     proveedor (registrar_pago_proveedor / registrar_pago_proveedor_multi_banca, que NO se tocan), crea el cargo de
--     comisión: un egreso en la MISMA cuenta, con concepto "Comisión bancaria 0.3% – PG-0012" (o AD-), ligado al
--     movimiento del pago. La base es TODO lo que ese pago debita de la cuenta (pago + adelanto del mismo grupo y
--     cuenta), porque una cuenta puede generar dos filas (pago y adelanto) y la comisión es una sola.
--     Comisión = greatest(round(base * 0.003, 2), 14)  (espejo de shared/types/comision-bancaria.ts).
--     A diferencia de Wallet NO valida saldo: un pago a proveedor puede dejar la cuenta en negativo (regla vigente).
--  2. anular_pago_cobro (migration_editar_anular_transacciones.sql) se reemplaza con la misma firma y el mismo
--     cuerpo, más un paso al inicio: si el pago lleva cargos de comisión, los anula junto con el pago. Sin ese paso el
--     guardián de comisiones (trigger de Wallet) bloquearía la anulación de un pago con comisión. Un pago sin
--     comisión se anula exactamente igual que antes.
--
-- Edición: igual que en Wallet, un pago con comisión no admite cambios de montos, cuentas o facturas (409 del
-- backend: se anula y se registra de nuevo); concepto, referencia, fecha y comprobantes siguen editables.
-- Wallet: el cargo se muestra como un egreso más y no se anula por separado (el backend ya lo rechaza: es la
-- comisión de otro movimiento). Categoría: la fija el trigger de docs/migration_categoria_comisiones_bancarias.sql.
--
-- Requisitos: migration_wallet_comision_bancaria.sql (columnas, guardián y RPC de Wallet) y
-- migration_editar_anular_transacciones.sql. Idempotente (CREATE OR REPLACE). No inserta ni modifica datos.
-- ROLLBACK: docs/migration_pago_comision_bancaria_ROLLBACK.sql. Hacer backup antes de aplicar. NO se aplica sola.
-- Mientras no esté aplicada, el backend rechaza "Sí" a la comisión de un pago (503/400 con aviso) y una cuenta en Bs
-- se paga como siempre.
-- =============================================================================

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'movimientos' and column_name = 'comision_de_id'
  ) or to_regprocedure('public.anular_movimiento_con_comision_bancaria(uuid, text, uuid)') is null then
    raise exception 'Falta aplicar docs/migration_wallet_comision_bancaria.sql antes de esta migración.';
  end if;
  if to_regprocedure('public.anular_pago_cobro(uuid, text, uuid)') is null then
    raise exception 'Falta aplicar docs/migration_editar_anular_transacciones.sql antes de esta migración.';
  end if;
end $$;

-- 1. Cargo de comisión de un pago ya registrado ----------------------------------------------------------
create or replace function public.agregar_comision_bancaria_a_pago(p_movimiento_id uuid, p_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_tasa     constant numeric := 0.003;  -- 0.3 %
  c_minimo   constant numeric := 14;     -- Bs
  m          public.movimientos;
  v_base     numeric;
  v_comision numeric;
  v_codigo   text;
  v_com_id   uuid;
begin
  if p_movimiento_id is null then raise exception 'Falta el movimiento al que se carga la comisión.'; end if;
  if p_usuario is null then raise exception 'Falta el usuario que registra la comisión.'; end if;

  select * into m from public.movimientos where id = p_movimiento_id for update;
  if not found then raise exception 'Movimiento no encontrado.'; end if;
  if m.anulado then raise exception 'El pago está anulado: no se le puede cargar comisión.'; end if;
  if m.tipo::text <> 'egreso' or m.subtipo is null or m.subtipo not in ('pago', 'adelanto') or m.proveedor_id is null then
    raise exception 'La comisión bancaria solo se carga a un pago o adelanto a proveedor.';
  end if;
  if m.moneda <> 'VES' then
    raise exception 'La comisión bancaria solo aplica cuando la cuenta de origen está en bolívares (Bs).';
  end if;
  if m.comision_bancaria is not null then raise exception 'Este pago ya tiene comisión bancaria.'; end if;

  perform 1 from public.bancas where id = m.banca_origen_id for update;

  select coalesce(sum(x.monto), 0) into v_base
    from public.movimientos x
   where not x.anulado
     and x.tipo::text = 'egreso'
     and x.subtipo in ('pago', 'adelanto')
     and x.banca_origen_id = m.banca_origen_id
     and coalesce(x.grupo_id, x.id) = coalesce(m.grupo_id, m.id);

  v_comision := greatest(round(v_base * c_tasa, 2), c_minimo);
  v_codigo := case when m.subtipo = 'adelanto' then 'AD-' else 'PG-' end || lpad(coalesce(m.numero, 0)::text, 4, '0');

  insert into public.movimientos
    (tipo, monto, moneda, descripcion, banca_origen_id, fecha, referencia, registrado_por, comision_de_id)
  values
    ('egreso', v_comision, m.moneda, 'Comisión bancaria 0.3% – ' || v_codigo, m.banca_origen_id, m.fecha,
     m.referencia, p_usuario, m.id)
  returning id into v_com_id;

  -- El principal aún no tiene comisión: el guardián (solo vigila los que ya la tienen) no se interpone.
  update public.movimientos set comision_bancaria = v_comision where id = m.id;

  return jsonb_build_object(
    'comisionId', v_com_id, 'comision', v_comision, 'base', round(v_base, 2),
    'totalDebitado', round(v_base + v_comision, 2));
end;
$$;

-- 2. Anular un pago/cobro/cruce: ahora también anula la comisión del pago --------------------------------
-- Cuerpo idéntico al de migration_editar_anular_transacciones.sql salvo el bloque marcado con (NUEVO).
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
  v_cargo   uuid;                     -- (NUEVO)
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

  -- (NUEVO) Comisión bancaria del pago: se anula el cargo (devuelve su dinero a la cuenta) antes de anular el pago.
  -- El GUC deja pasar al guardián de comisiones en esta transacción.
  perform set_config('app.comision_bancaria_rpc', 'on', true);
  for v_cargo in
    select c.id
      from public.movimientos c
      join public.movimientos m on m.id = c.comision_de_id
     where (m.grupo_id = p_grupo_id or (m.grupo_id is null and m.id = p_grupo_id)) and not c.anulado
  loop
    perform public.anular_movimiento_banca(v_cargo, 'Comisión de un pago anulado: ' || btrim(p_motivo), p_usuario);
  end loop;

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

-- 3. Permisos: solo el backend (service_role) ejecuta las RPC ---------------------------------------------
revoke execute on function public.agregar_comision_bancaria_a_pago(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.anular_pago_cobro(uuid, text, uuid) from public, anon, authenticated;

grant execute on function public.agregar_comision_bancaria_a_pago(uuid, uuid) to service_role;
grant execute on function public.anular_pago_cobro(uuid, text, uuid) to service_role;

commit;

-- Recarga el esquema de PostgREST (función nueva visible para el backend sin reiniciar).
notify pgrst, 'reload schema';

-- Verificación a mano (solo lectura, después de aplicar y de registrar un pago de prueba con comisión):
--   select m.numero, m.subtipo, m.monto, m.comision_bancaria, c.numero_sistema as num_cargo, c.monto as cargo, c.descripcion
--     from public.movimientos m join public.movimientos c on c.comision_de_id = m.id
--    where m.subtipo in ('pago', 'adelanto') order by m.creado_en desc limit 10;
--   -- pagos con comisión sin su cargo vigente (debe dar 0 filas, salvo anulados):
--   select m.id from public.movimientos m
--    where m.subtipo in ('pago', 'adelanto') and m.comision_bancaria is not null and not m.anulado
--      and not exists (select 1 from public.movimientos c where c.comision_de_id = m.id and not c.anulado);
