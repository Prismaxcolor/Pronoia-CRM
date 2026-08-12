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
