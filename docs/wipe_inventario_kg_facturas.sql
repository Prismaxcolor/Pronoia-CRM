-- =============================================================================
-- LIMPIEZA: vaciar todos los movimientos de kg + facturas de compra/venta para
-- pruebas limpias. Se mantiene estructura: productos, categorías (tipos_material),
-- lotes, almacenes, proveedores, clientes, usuarios, listas de precios, taras,
-- vehículos, bancas (cuentas), transformacion_salidas_comunes (config, no
-- movimiento), tasas_cambio (histórico de referencia, no es "kilos/facturas").
--
-- Confirmado con el dueño (Julio, 2026-09-09, re-confirmado 2026-09-14): toda
-- la data actual es de prueba, autorizado wipe completo de kg + facturas
-- compra/venta — "no borres ni a los clientes ni sus datos ni los productos,
-- ni los lotes, sino lo que está dentro de ellos".
--
-- ACTUALIZADO 14-sep-2026: se agregó detalle_traslado_composicion (tabla
-- nueva de esta sesión, snapshot de composición de traslados) y el reset de
-- bancas.saldo (columna de saldo corriente que queda huérfana al vaciar
-- movimientos — mismo tratamiento que lotes.composicion).
--
-- Verificado contra el listado real de tablas de information_schema (no solo
-- de memoria): ninguna tabla fuera de esta lista referencia (FK) ninguna
-- tabla de esta lista, salvo detalle_traslado_composicion → detalle_traslado
-- (ambas están en la lista, así que CASCADE la cubre igual aunque no
-- estuviera explícita).
-- =============================================================================

begin;

truncate table
  detalle_facturas_compra,
  detalle_facturas_venta,
  facturas_compra_tickets,
  facturas_venta_tickets,
  notas_ajuste_proveedor,
  notas_ajuste_cliente,
  pago_aplicaciones,
  guias_corpoez,
  pesajes_globales,
  movimientos,
  facturas_compra,
  facturas_venta,
  detalle_tickets_pesaje,
  tickets_pesaje,
  detalle_traslado_composicion,
  detalle_traslado,
  tickets_traslado,
  ajustes_inventario,
  detalle_toma_fisica,
  tomas_fisicas_inventario,
  transformacion_entrada_detalle,
  transformacion_salida_detalle,
  transformaciones,
  facturas,
  factura_items,
  citas_despacho
cascade;

-- lotes.composicion es una columna jsonb vestigial: el backend siempre
-- deriva composición en vivo vía composicion_lote()/composicion_lote_almacen(),
-- nunca lee ni escribe esta columna. Se limpia solo por prolijidad.
update public.lotes set composicion = '[]'::jsonb where composicion is not null;

-- bancas.saldo es un saldo corriente que se alimentaba de `movimientos`
-- (ya vaciada) — queda huérfano/desactualizado si no se resetea.
update public.bancas set saldo = 0 where saldo <> 0;

-- Reiniciar contadores para que las pruebas empiecen en 0001 de nuevo.
alter sequence notas_credito_cliente_numero_seq restart with 1;
alter sequence notas_debito_cliente_numero_seq restart with 1;
alter sequence movimientos_cobro_numero_seq restart with 1;
alter sequence movimientos_anticipo_cliente_numero_seq restart with 1;
alter sequence tickets_pesaje_numero_seq restart with 1;
alter sequence tomas_fisicas_inventario_numero_seq restart with 1;
alter sequence facturas_compra_numero_seq restart with 1;
alter sequence facturas_venta_numero_seq restart with 1;
alter sequence tickets_pesaje_numero_compra_seq restart with 1;
alter sequence tickets_traslado_numero_seq restart with 1;
alter sequence tickets_pesaje_numero_venta_seq restart with 1;
alter sequence movimientos_pago_numero_seq restart with 1;
alter sequence movimientos_adelanto_numero_seq restart with 1;
alter sequence notas_credito_numero_seq restart with 1;
alter sequence notas_debito_numero_seq restart with 1;
alter sequence facturas_numero_seq restart with 1;

commit;
