-- =============================================================================
-- OPCIONAL (Julio decide si se corre): categoria de Wallet para los pagos a proveedor HISTORICOS.
--
-- Los pagos registrados antes de migration_categorias_uso.sql + este cambio quedaron "Sin categoria".
-- Este script les pone la categoria fija del uso 'pago_proveedor' (COMPRA DE MATERIA PRIMA) a los
-- egresos de pagos a proveedor (subtipo 'pago' y 'adelanto'). Los COBROS historicos NO se tocan: la
-- categoria de un cobro (VENTA DE CHATARRA NF o PCB) se elige a mano, uno por uno.
--
-- Requiere: migration_wallet_categorias.sql y migration_categorias_uso.sql aplicadas.
-- Idempotente: solo toca filas con categoria_id nulo; correrlo dos veces no cambia nada la segunda vez.
-- No cambia montos, fechas, saldos ni numeracion. Incluye anulados (conservan su categoria como los vigentes;
-- los reportes ya los excluyen).
-- NO se aplica desde el codigo. Revertir: ver el bloque ROLLBACK al final.
--
-- Conteos previos (produccion, 2026-10-12, antes de correr):
--   egreso / pago     / con proveedor / sin categoria : 21 filas (USD 37298.47)
--   egreso / adelanto / con proveedor / sin categoria : 15 filas (USD 22491.53)
--   => se actualizarian 36 filas. Anulados: 0.
--   ingreso / cobro   / con cliente   / sin categoria :  1 fila  (USD 1157)  -> NO se toca (se elige a mano).
-- Consulta para repetir los conteos:
--   select subtipo, anulado, count(*), sum(monto_usd) from public.movimientos
--    where tipo = 'egreso' and subtipo in ('pago', 'adelanto') and proveedor_id is not null and categoria_id is null
--    group by 1, 2;
-- =============================================================================

begin;

do $$
declare
  v_cat   uuid;
  v_filas integer;
begin
  select u.categoria_id into v_cat from public.categorias_uso u where u.uso = 'pago_proveedor';
  if v_cat is null then
    raise exception 'El uso pago_proveedor no tiene categoria asignada (revisa public.categorias_uso).';
  end if;

  update public.movimientos
     set categoria_id = v_cat
   where tipo = 'egreso'
     and subtipo in ('pago', 'adelanto')
     and proveedor_id is not null
     and categoria_id is null;
  get diagnostics v_filas = row_count;
  raise notice 'Pagos a proveedor historicos clasificados: %', v_filas;
end $$;

commit;

-- Verificacion (a mano), esperado: 0 filas sin categoria
--   select count(*) from public.movimientos
--    where tipo = 'egreso' and subtipo in ('pago', 'adelanto') and proveedor_id is not null and categoria_id is null;

-- ROLLBACK (solo si se corrio y hay que deshacer; quita la categoria a TODOS los pagos a proveedor,
-- tambien a los registrados despues con categoria, asi que usalo solo justo despues de correr este script):
--   update public.movimientos set categoria_id = null
--    where tipo = 'egreso' and subtipo in ('pago', 'adelanto') and proveedor_id is not null
--      and categoria_id = (select categoria_id from public.categorias_uso where uso = 'pago_proveedor');
