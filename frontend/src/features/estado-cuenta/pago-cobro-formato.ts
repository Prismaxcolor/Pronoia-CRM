/** Monto en USD con separadores locales (2 a 3 decimales), como se muestra en el registro de pagos y cobros. */
export function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}
