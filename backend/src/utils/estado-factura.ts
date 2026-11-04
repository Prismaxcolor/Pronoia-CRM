/**
 * Estado de una factura según sus pagos: ÚNICA fuente de verdad en el backend.
 * Espejo (duplicado intencional) de frontend/src/lib/estado-factura.ts; el test
 * backend/tests/estado-factura.test.ts exige que ambos devuelvan lo mismo.
 *
 * - emitida:   la factura no tiene ningún pago (ni adelanto ni nota de crédito aplicados).
 * - pendiente: ya tiene al menos un pago y todavía le queda saldo.
 * - pagada:    no le queda saldo (total menos lo aplicado, con tolerancia de un centavo).
 * - borrador / anulada: no dependen de los pagos y se devuelven tal cual.
 *
 * `montoPagado` es lo aplicado a la factura: efectivo, adelantos y notas de crédito
 * (la BD lo acumula en facturas_compra/venta.monto_pagado). En BD el estado guardado
 * sigue siendo emitida|pagada; 'pendiente' solo existe como estado derivado.
 */

export type EstadoFacturaGuardado = 'borrador' | 'emitida' | 'pagada' | 'anulada';
export type EstadoFacturaDerivado = 'borrador' | 'emitida' | 'pendiente' | 'pagada' | 'anulada';

export interface DatosEstadoFactura {
  estado: EstadoFacturaGuardado;
  total: number;
  montoPagado: number;
}

/** Diferencia máxima (en centavos) que se trata como cero al comparar saldos. */
const TOLERANCIA_CENTAVOS = 1;

function aCentavos(n: number): number {
  return Number.isFinite(n) ? Math.round(Number((n * 100).toPrecision(15))) : 0;
}

/** Saldo que le queda a la factura (USD, nunca negativo; un sobrepago da 0). */
export function saldoFactura(f: Pick<DatosEstadoFactura, 'total' | 'montoPagado'>): number {
  const saldo = aCentavos(f.total) - aCentavos(f.montoPagado);
  return saldo <= TOLERANCIA_CENTAVOS ? 0 : saldo / 100;
}

export function derivarEstadoFactura(f: DatosEstadoFactura): EstadoFacturaDerivado {
  if (f.estado === 'borrador' || f.estado === 'anulada') return f.estado;
  // Lo guardado como pagada manda: una diferencia de monto no la devuelve a pendiente.
  if (f.estado === 'pagada') return 'pagada';
  if (aCentavos(f.montoPagado) <= 0) return 'emitida';
  return saldoFactura(f) === 0 ? 'pagada' : 'pendiente';
}

/** Estados con deuda viva: la factura se puede pagar o cruzar. */
export function tieneSaldoPendiente(estado: EstadoFacturaDerivado): boolean {
  return estado === 'emitida' || estado === 'pendiente';
}
