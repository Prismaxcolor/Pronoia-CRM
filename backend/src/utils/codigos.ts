/** Formatea el correlativo de una factura de compra: 1 → "C-0001". */
export function formatCodigoCompra(numero: number): string {
  return `C-${String(numero).padStart(4, '0')}`;
}

/** Formatea el correlativo de una factura de venta: 1 → "V-0001". */
export function formatCodigoVenta(numero: number): string {
  return `V-${String(numero).padStart(4, '0')}`;
}

/** Formatea el correlativo de un pago a proveedor: 1 → "PG-0001". */
export function formatCodigoPagoProveedor(numero: number): string {
  return `PG-${String(numero).padStart(4, '0')}`;
}

/** Formatea el correlativo de un adelanto a proveedor: 1 → "AD-0001". */
export function formatCodigoAdelanto(numero: number): string {
  return `AD-${String(numero).padStart(4, '0')}`;
}

/** Formatea el correlativo de una nota de crédito: 1 → "NC-0001". */
export function formatCodigoNotaCredito(numero: number): string {
  return `NC-${String(numero).padStart(4, '0')}`;
}

/** Formatea el correlativo de una nota de débito: 1 → "ND-0001". */
export function formatCodigoNotaDebito(numero: number): string {
  return `ND-${String(numero).padStart(4, '0')}`;
}

/** Formatea el correlativo de un cobro a cliente: 1 → "CB-0001". Numeración
 *  propia, separada de PG- (pago a proveedor) — decisión de Julio. */
export function formatCodigoCobroCliente(numero: number): string {
  return `CB-${String(numero).padStart(4, '0')}`;
}

/** Formatea el correlativo de un anticipo de cliente: 1 → "AC-0001". Numeración
 *  propia, separada de AD- (adelanto a proveedor). */
export function formatCodigoAnticipoCliente(numero: number): string {
  return `AC-${String(numero).padStart(4, '0')}`;
}

/** Formatea el correlativo de una nota de crédito a cliente: 1 → "NCV-0001".
 *  Numeración propia, separada de NC- (nota de crédito a proveedor). */
export function formatCodigoNotaCreditoCliente(numero: number): string {
  return `NCV-${String(numero).padStart(4, '0')}`;
}

/** Formatea el correlativo de una nota de débito a cliente: 1 → "NDV-0001".
 *  Numeración propia, separada de ND- (nota de débito a proveedor). */
export function formatCodigoNotaDebitoCliente(numero: number): string {
  return `NDV-${String(numero).padStart(4, '0')}`;
}
