/**
 * Movimientos de Wallet con proveedor o cliente que son adelantos/anticipos.
 *
 * Un EGRESO de Wallet que lleva proveedor es dinero entregado al proveedor sin una factura concreta: en su estado de
 * cuenta es un ADELANTO (AD-), igual que el excedente de un pago. Un INGRESO que lleva cliente es dinero recibido del
 * cliente: en su estado de cuenta es un ANTICIPO (AC-). Así queda disponible para cruzarlo después con facturas.
 * Las transferencias no cuentan, ni un egreso con cliente ni un ingreso con proveedor (no son adelantos).
 */

export type SubtipoAdelanto = 'adelanto' | 'anticipo';

export interface DatosMovimientoEntidad {
  tipo: 'ingreso' | 'egreso' | 'transferencia';
  proveedorId?: string | null;
  clienteId?: string | null;
}

/** Subtipo que le corresponde al movimiento, o null si es un movimiento manual común. */
export function subtipoAdelantoDeMovimiento(m: DatosMovimientoEntidad): SubtipoAdelanto | null {
  if (m.tipo === 'egreso' && m.proveedorId) return 'adelanto';
  if (m.tipo === 'ingreso' && m.clienteId) return 'anticipo';
  return null;
}
