-- =============================================================================
-- OPCIONAL (Julio decide si se corre): categoría COMISIONES BANCARIAS para los cargos de comisión HISTÓRICOS.
--
-- Los cargos de comisión bancaria registrados antes de migration_categoria_comisiones_bancarias.sql quedaron sin
-- categoría (Wallet) o con la categoría del egreso principal (nómina). Este script les pone la categoría fija del uso
-- `comision_bancaria`. Un cargo de comisión es todo movimiento con comision_de_id (apunta al movimiento que lo originó).
--
-- Requiere: migration_wallet_categorias.sql, migration_categorias_uso.sql, migration_wallet_comision_bancaria.sql y
-- migration_categoria_comisiones_bancarias.sql (crea la categoría y el uso).
-- Idempotente: correrlo dos veces no cambia nada la segunda vez. No cambia montos, fechas, saldos ni numeración.
-- Incluye anulados (conservan la categoría como los vigentes; los reportes ya los excluyen).
-- NO se aplica desde el código. Para deshacer: ver el bloque ROLLBACK al final.
--
-- Dos pasos, controlados por la variable de abajo:
--   * Paso 1 (siempre): cargos SIN categoría.
--   * Paso 2 (solo si v_incluir_otras = true): cargos que YA tienen otra categoría (p. ej. los de nómina, que llevaban la
--     del egreso principal). Por defecto NO se tocan: reasignarlos mueve esos montos de una categoría a otra en los
--     reportes. Revisa el conteo previo (verificar_categoria_comisiones.sql, consulta 2) antes de activarlo.
--
-- Primero ejecuta docs/verificar_categoria_comisiones.sql (consultas 1 y 2) para ver cuántas filas se afectarán.
-- =============================================================================

begin;

do $$
declare
  v_incluir_otras constant boolean := false;   -- true = también reasigna los cargos que ya tienen otra categoría
  v_cat           uuid;
  v_sin           integer;
  v_otras         integer := 0;
begin
  select u.categoria_id into v_cat from public.categorias_uso u where u.uso = 'comision_bancaria';
  if v_cat is null then
    raise exception 'El uso comision_bancaria no tiene categoría asignada: aplica migration_categoria_comisiones_bancarias.sql primero.';
  end if;

  update public.movimientos
     set categoria_id = v_cat
   where comision_de_id is not null
     and categoria_id is null;
  get diagnostics v_sin = row_count;

  if v_incluir_otras then
    update public.movimientos
       set categoria_id = v_cat
     where comision_de_id is not null
       and categoria_id is distinct from v_cat;
    get diagnostics v_otras = row_count;
  end if;

  raise notice 'Cargos de comisión clasificados: % sin categoría previa, % que tenían otra categoría.', v_sin, v_otras;
end $$;

commit;

-- Verificación (a mano), esperado: 0 filas sin categoría
--   select count(*) from public.movimientos where comision_de_id is not null and categoria_id is null;

-- ROLLBACK (solo justo después de correr este script; quita la categoría a TODOS los cargos de comisión que la tienen,
-- incluidos los que ya la traían por el trigger; los de nómina del paso 2 NO recuperan su categoría anterior):
--   update public.movimientos set categoria_id = null
--    where comision_de_id is not null
--      and categoria_id = (select categoria_id from public.categorias_uso where uso = 'comision_bancaria');
