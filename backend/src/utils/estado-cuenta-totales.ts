/**
 * Totales de un estado de cuenta (proveedor o cliente). Fuente de verdad del servidor (totales del servicio, PDF de portal/Telegram). Espejo (duplicado intencional,
 * porque el backend no puede importar en runtime desde shared/) en shared/types/estado-cuenta-totales.ts, que usa el
 * frontend; backend/tests/estado-cuenta-totales.test.ts verifica que ambos den lo mismo.
 *
 * Convención del sistema: `cargo` aumenta el saldo (facturas de compra/venta y notas de débito vigentes) y
 * `abono` lo reduce (pagos/cobros, adelantos y notas de crédito vigentes). Las notas anuladas y los cruces ya
 * llegan con cargo = abono = 0, así que no suman. El estado de cuenta se lleva en una sola moneda (USD): todo
 * monto se convierte a USD antes de llegar acá, por eso hay un único juego de totales.
 *
 * Se suma en centavos enteros para que el resultado no arrastre error de coma flotante.
 */

export interface FilaConImporte {
  cargo: number;
  abono: number;
}

export interface TotalesEstadoCuenta {
  /** Moneda de los importes (el estado de cuenta es siempre USD). */
  moneda: 'USD';
  /** Cantidad de filas sumadas. */
  filas: number;
  totalCargos: number;
  totalAbonos: number;
  /** totalCargos - totalAbonos. Positivo = se le debe pagar (proveedor) o nos debe (cliente); negativo = saldo a favor. */
  saldoFinal: number;
}

const aCentavos = (n: number): number => Math.round((Number(n) || 0) * 100);

export function totalesEstadoCuenta(filas: readonly FilaConImporte[]): TotalesEstadoCuenta {
  let cargos = 0;
  let abonos = 0;
  for (const f of filas) {
    cargos += aCentavos(f.cargo);
    abonos += aCentavos(f.abono);
  }
  return { moneda: 'USD', filas: filas.length, totalCargos: cargos / 100, totalAbonos: abonos / 100, saldoFinal: (cargos - abonos) / 100 };
}
