-- =============================================================================
-- Verificación de la categoría COMISIONES BANCARIAS (SOLO LECTURA). Para correr a mano, antes y después de
-- aplicar migration_categoria_comisiones_bancarias.sql y docs/correccion_categoria_comisiones_historicas.sql.
--
-- Cómo usarlo:
--   * TODO está comentado a propósito: NO se ejecuta nada al abrir o correr el archivo completo.
--   * Descomenta UNA consulta a la vez y ejecútala. Todas son `select`.
--   * "Debe dar 0 filas" = si devuelve filas, hay una inconsistencia que investigar.
-- Este archivo no modifica datos, no crea objetos y no hace commit de nada.
-- =============================================================================


-- 1. La categoría y su uso (esperado: 1 fila; si no hay filas, falta aplicar la migración) --------------------------
--
-- select c.id, c.nombre, c.tipo, c.activo, p.nombre as categoria_padre
--   from public.categorias_uso u
--   join public.categorias_wallet c on c.id = u.categoria_id
--   left join public.categorias_wallet p on p.id = c.padre_id
--  where u.uso = 'comision_bancaria';


-- 2. Cargos de comisión por categoría (antes de la corrección: sin categoría / con otra; después: todos en una) -----
--    Un cargo de comisión es todo movimiento con comision_de_id.
--
-- select coalesce(c.nombre, '(sin categoría)') as categoria, m.anulado, count(*) as cargos, round(sum(m.monto), 2) as total_bs
--   from public.movimientos m
--   left join public.categorias_wallet c on c.id = m.categoria_id
--  where m.comision_de_id is not null
--  group by 1, 2
--  order by 1, 2;


-- 3. Cargos de comisión que NO llevan la categoría fija (debe dar 0 filas después de la corrección) ------------------
--    Con el trigger aplicado, los nuevos nunca aparecen aquí.
--
-- select m.id, m.numero_sistema, m.fecha, m.monto, m.descripcion, c.nombre as categoria_actual
--   from public.movimientos m
--   left join public.categorias_wallet c on c.id = m.categoria_id
--  where m.comision_de_id is not null
--    and m.categoria_id is distinct from (select categoria_id from public.categorias_uso where uso = 'comision_bancaria')
--  order by m.fecha desc;


-- 4. Origen de cada cargo (de qué operación nace): Wallet, pago a proveedor o nómina --------------------------------
--
-- select case
--          when p.subtipo in ('pago', 'adelanto') then 'pago a proveedor'
--          when exists (select 1 from public.nomina_pagos np where np.movimiento_id = p.id) then 'nómina'
--          else 'wallet'
--        end as origen,
--        count(*) as cargos, count(*) filter (where c.categoria_id is null) as sin_categoria
--   from public.movimientos c
--   join public.movimientos p on p.id = c.comision_de_id
--  group by 1
--  order by 1;


-- 5. Posibles comisiones registradas A MANO (sin vínculo comision_de_id) que conviene revisar ------------------------
--    Egresos cuyo concepto menciona comisión bancaria pero que no están ligados a ningún movimiento. Si son
--    comisiones reales, cámbiales la categoría desde la tabla de movimientos de Wallet (uno a uno).
--
-- select m.id, m.numero_sistema, m.fecha, m.monto, m.moneda, m.descripcion, c.nombre as categoria_actual
--   from public.movimientos m
--   left join public.categorias_wallet c on c.id = m.categoria_id
--  where m.tipo::text = 'egreso' and m.comision_de_id is null and not m.anulado
--    and m.descripcion ilike '%comisi%banc%'
--  order by m.fecha desc;


-- 6. Pagos con comisión: cada uno con su cargo vigente (debe dar 0 filas; ver también migration_pago_comision_bancaria.sql)
--
-- select m.id, m.numero, m.subtipo
--   from public.movimientos m
--  where m.comision_bancaria is not null and not m.anulado
--    and not exists (select 1 from public.movimientos c where c.comision_de_id = m.id and not c.anulado);
