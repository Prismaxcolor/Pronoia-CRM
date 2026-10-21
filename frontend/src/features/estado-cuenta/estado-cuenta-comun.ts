import type { EntradaEstadoCuenta, TipoEntidad } from '../../services/estado-cuenta-service';
import type { Tono } from '../../lib/paleta';

/** Importe con 2 decimales es-VE (sin unidad: las tablas del estado de cuenta ya van en USD). */
export function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const LABEL_POR_TIPO: Record<EntradaEstadoCuenta['tipo'], string> = {
  factura: 'Factura',
  pago: 'Pago',
  adelanto: 'Adelanto',
  nota_credito: 'Nota crédito',
  nota_debito: 'Nota débito',
  cruce: 'Cruce',
};

/** Qué significa cada tipo de movimiento (texto del title de su insignia). */
export const AYUDA_POR_TIPO: Record<EntradaEstadoCuenta['tipo'], string> = {
  factura: 'Factura emitida: hace subir el saldo.',
  pago: 'Pago o cobro de dinero: hace bajar el saldo.',
  adelanto: 'Dinero entregado por adelantado y aún sin aplicar a facturas: hace bajar el saldo y se puede usar en un cruce.',
  nota_credito: 'Ajuste a favor de la cuenta: hace bajar el saldo.',
  nota_debito: 'Ajuste en contra de la cuenta: hace subir el saldo.',
  cruce: 'Facturas saldadas con adelantos o notas de crédito sin mover dinero: el saldo no cambia.',
};

/** Tono de la insignia de cada tipo (el texto de la etiqueta es lo que lo distingue; el color solo acompaña). */
export const TONO_POR_TIPO: Record<EntradaEstadoCuenta['tipo'], Tono> = {
  factura: 'aviso',
  pago: 'exito',
  adelanto: 'marca',
  nota_credito: 'info',
  nota_debito: 'neutral',
  cruce: 'neutral',
};

/** Ruta destino del detalle imprimible de una entrada del estado de cuenta,
 *  o null si esa fila no tiene detalle propio. */
export function rutaDetalle(tipo: TipoEntidad, entidadId: string, e: EntradaEstadoCuenta): string | null {
  if (e.tipo === 'factura' && e.facturaId) {
    return `${tipo === 'proveedor' ? '/compras' : '/ventas'}/${e.facturaId}`;
  }
  if ((e.tipo === 'nota_credito' || e.tipo === 'nota_debito') && e.notaId) {
    return `${tipo === 'proveedor' ? '/proveedores' : '/clientes'}/${entidadId}/notas/${e.notaId}`;
  }
  if ((e.tipo === 'pago' || e.tipo === 'adelanto' || e.tipo === 'cruce') && e.pagoId) {
    return `${tipo === 'proveedor' ? '/proveedores' : '/clientes'}/${entidadId}/pagos/${e.pagoId}`;
  }
  return null;
}
