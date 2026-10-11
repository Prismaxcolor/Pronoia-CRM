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
  subtipo: 'pago' | 'adelanto' | 'cobro' | 'anticipo' | null;
  /** Correlativo (PG-.../AD-...), null si `subtipo` es null. */
  numero: number | null;
  /**
   * Correlativo del sistema (MV-0001) de un movimiento manual de Wallet. Null en pagos/cobros (conservan
   * su numeración PG-/AD-/CB-/AC-) y en movimientos anteriores a la migración.
   */
  numeroSistema: number | null;
  /** Agrupa las filas de una misma operación (pago repartido entre bancas). */
  grupoId: string | null;
  /** URLs de los comprobantes (fotos) del movimiento. */
  comprobantes: string[];
  /** true si el movimiento fue anulado: se conserva la fila, pero no cuenta en saldos ni estados de cuenta. */
  anulado: boolean;
  anuladoMotivo: string | null;
  anuladoEn: string | null;
  /** Id de quien anuló. */
  anuladoPor: string | null;
  /** Categoría o subcategoría del Wallet (null = sin categoría; las transferencias y los pagos/cobros no llevan). */
  categoriaId?: string | null;
  // Campos de mesa de cambio: opcionales porque la API los omite (o los manda null) en movimientos normales y
  // mientras la migración de transferencias con mesa de cambio no esté aplicada.
  /** Transferencia con mesa de cambio: cambista elegido; null en un movimiento normal. */
  mesaCambistaId?: string | null;
  /**
   * 'en_proceso': el origen ya se descontó pero el destino NO ha recibido el saldo. 'completada': ya se acreditó
   * (neto de comisión). Si `anulado` es true, la anulación manda.
   */
  mesaEstado?: 'en_proceso' | 'completada' | null;
  /** Lo que el cambista debía entregar en la cuenta destino (moneda destino), antes de la comisión. */
  mesaMontoBruto?: number | null;
  mesaComisionModo?: 'porcentaje' | 'monto' | null;
  mesaComisionPct?: number | null;
  /** Comisión del cambio en la moneda destino. Reduce lo acreditado: neto = bruto - comisión. */
  mesaComision?: number | null;
  mesaCompletadaEn?: string | null;
  mesaCompletadaPor?: string | null;
  // Comisión bancaria (0.3%, mínimo 14 Bs) de un movimiento que debita una cuenta en Bs; opcionales porque la API los
  // omite (o los manda null) en movimientos normales y mientras la migración no esté aplicada.
  /** En el movimiento principal: comisión (Bs) cargada a la misma cuenta como un egreso aparte. */
  comisionBancaria?: number | null;
  /** En el cargo de la comisión: id del movimiento principal al que pertenece. */
  comisionDeId?: string | null;
}
