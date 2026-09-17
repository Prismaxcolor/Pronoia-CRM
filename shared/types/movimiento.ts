export type TipoMovimiento = 'ingreso' | 'egreso' | 'transferencia';

export interface Movimiento {
  id: string;
  tipo: TipoMovimiento;
  monto: number;
  moneda: string;
  descripcion: string;
  bancaOrigenId: string;
  bancaDestinoId: string | null;
  fecha: string;
  referencia: string;
  registradoPor: string;
  /** Proveedor al que se le pagó (egreso). Alimenta su estado de cuenta. */
  proveedorId: string | null;
  /** Cliente del que se cobró (ingreso). Alimenta su estado de cuenta. */
  clienteId: string | null;
  /**
   * Equivalente en USD del movimiento. Los pagos a proveedores siempre se
   * registran en USD para efectos de estado de cuenta, aunque `monto`/`moneda`
   * reflejen la banca de origen (ej. Bs si se pagó desde una cuenta en
   * bolívares). Null en movimientos que no lo necesitan (ya están en USD).
   */
  montoUsd: number | null;
  /**
   * Solo transferencias entre bancas de monedas distintas: lo que entra a la
   * banca destino, en su propia moneda, aplicando la tasa elegida al
   * momento de transferir. Null si es transferencia misma moneda (se usa
   * `monto` para ambos lados) o si el movimiento no es una transferencia.
   */
  montoDestino: number | null;
  creadoEn: string;
  /** Solo egresos a proveedor: distingue pago de adelanto (Bloque 38). */
  subtipo: 'pago' | 'adelanto' | null;
  /** Correlativo (PG-.../AD-...), null si `subtipo` es null. */
  numero: number | null;
  /** Agrupa las filas de una misma operación (pago repartido entre bancas). */
  grupoId: string | null;
}
