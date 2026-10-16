/**
 * Pago (desembolso) de un préstamo o adelanto a un trabajador desde el Wallet: reglas puras para validar la cuenta elegida y
 * calcular lo que sale de ella ANTES de llamar a la función SQL nomina_prestamo_pagar, que es la autoridad (vuelve a validar
 * cuenta, saldo, comisión y monto).
 *
 * El préstamo es siempre en USD. Desde una cuenta USD sale ese mismo monto; desde una cuenta en Bs sale monto x tasa, con la
 * tasa (Bs por USD) que escribe quien paga, redondeado al centavo (igual que la función SQL: round(monto x tasa, 2)).
 */
import { comisionDe, type CuentaWallet, type FalloPlan } from './nomina-pago.js';

export interface EntradaDesembolso {
  cuenta: CuentaWallet | undefined;
  montoUsd: number;
  /** Solo se usa si la cuenta es en Bs. */
  tasaBs: number | null;
  llevaComision?: boolean;
  comisionDisponible: boolean;
}

export interface DesembolsoPlanificado {
  /** Monto que sale de la cuenta, en la moneda de la cuenta. */
  montoCuenta: number;
  /** Tasa usada (solo cuentas en Bs); null en cuentas USD. */
  tasaBs: number | null;
  llevaComision: boolean | null;
}

/** Monto en Bs de un monto en USD a una tasa, al centavo. */
export function montoEnBs(montoUsd: number, tasaBs: number): number {
  return Math.round(montoUsd * 100 * tasaBs) / 100;
}

export function planificarDesembolso(e: EntradaDesembolso): DesembolsoPlanificado | FalloPlan {
  const { cuenta } = e;
  if (!cuenta) return { error: 'La cuenta elegida no existe.', codigo: 400 };
  if (cuenta.archivada) return { error: `La cuenta ${cuenta.nombre} está archivada.`, codigo: 400 };
  if (cuenta.moneda !== 'USD' && cuenta.moneda !== 'VES') {
    return { error: `La cuenta ${cuenta.nombre} es en ${cuenta.moneda}: el préstamo solo se paga desde una cuenta en USD o en bolívares.`, codigo: 400 };
  }
  const comision = comisionDe({ llevaComision: e.llevaComision }, cuenta, e.comisionDisponible);
  if ('error' in comision) return comision;
  if (cuenta.moneda === 'USD') return { montoCuenta: e.montoUsd, tasaBs: null, llevaComision: comision.llevaComision };
  if (e.tasaBs === null || !(e.tasaBs > 0)) {
    return { error: 'Indica la tasa (Bs por USD) para pagar desde una cuenta en bolívares.', codigo: 400 };
  }
  return { montoCuenta: montoEnBs(e.montoUsd, e.tasaBs), tasaBs: e.tasaBs, llevaComision: comision.llevaComision };
}
