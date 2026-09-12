-- =============================================================================
-- LIMPIEZA: vaciar todos los movimientos de kg + facturas de compra/venta para
-- pruebas limpias. Se mantiene estructura: productos, categorías (tipos_material),
-- lotes, almacenes, proveedores, clientes, usuarios, listas de precios,
-- transformacion_salidas_comunes (config, no movimiento).
--
-- Confirmado con el dueño (Julio, 2026-09-09): toda la data actual es de
-- prueba, autorizado wipe completo de kg + facturas compra/venta.
--
-- Verificado antes de aplicar: ninguna tabla fuera de esta lista referencia
-- (FK) ninguna tabla de esta lista — TRUNCATE CASCADE no toca nada fuera de
-- lo listado aquí.
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

-- lotes.composicion es una columna jsonb vestigial: el backend actual
-- (lote-service.ts) siempre deriva composición en vivo vía composicion_lote(),
-- nunca lee ni escribe esta columna. Se limpia solo por prolijidad.
update public.lotes set composicion = '[]'::jsonb where composicion is not null;

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
