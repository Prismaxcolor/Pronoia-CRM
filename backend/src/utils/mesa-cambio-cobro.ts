/**
 * Cobro (total o parcial) de una transferencia con mesa de cambio, sin base de datos.
 * Espejo de la aritmética de cobrar_transferencia_mesa_cambio (docs/migration_mesa_cambio_cobro_parcial.sql),
 * que es la autoridad. Todo en centavos; devuelve valores nuevos y nunca muta la entrada.
 *
 * Reglas: el neto (bruto - comisión) es lo que el cambista debe entregar. Cada cobro acredita ese importe al
 * destino y salda una parte proporcional del CARGO en USD; el cobro que completa toma el resto exacto del
 * CARGO, así la suma de los COBRO siempre iguala al CARGO y el saldo del cambista vuelve a 0.
 */

export interface EntradaCobroMesa {
  /** Lo que el cambista debe entregar en total (bruto - comisión), moneda destino. */
  neto: number;
  /** Ya cobrado antes de este cobro (moneda destino). */
  cobrado: number;
  /** Importe del asiento CARGO vigente (USD). */
  cargoUsd: number;
  /** Suma de los COBRO vigentes ya registrados (USD). */
  usdYaCobrado: number;
  /** Monto de este cobro; null = todo lo pendiente. */
  monto: number | null;
}

export type PlanCobroMesa =
  | { ok: true; cobro: number; pendiente: number; completa: boolean; usdCobro: number }
  | { ok: false; error: string };

const redondear2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function planificarCobroMesa(e: EntradaCobroMesa): PlanCobroMesa {
  const pendienteActual = redondear2(e.neto - e.cobrado);
  if (pendienteActual <= 0) return { ok: false, error: 'Esta transferencia ya fue cobrada por completo.' };
  const cobro = e.monto === null ? pendienteActual : redondear2(e.monto);
  if (!(cobro > 0)) return { ok: false, error: 'El monto a cobrar debe ser mayor a 0.' };
  if (cobro > pendienteActual) {
    return { ok: false, error: `El monto a cobrar supera lo pendiente (${pendienteActual.toFixed(2)}).` };
  }
  const pendiente = redondear2(pendienteActual - cobro);
  const completa = pendiente === 0;
  const usdCobro = completa ? redondear2(e.cargoUsd - e.usdYaCobrado) : redondear2((e.cargoUsd * cobro) / e.neto);
  if (!(usdCobro > 0)) return { ok: false, error: 'El monto a cobrar es demasiado pequeño para registrarse en USD.' };
  return { ok: true, cobro, pendiente, completa, usdCobro };
}
