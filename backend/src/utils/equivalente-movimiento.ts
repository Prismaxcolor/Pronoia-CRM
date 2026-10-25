/**
 * Equivalente en USD de los movimientos en Bs de la pantalla Wallet (puro, sin BD).
 * Un movimiento con `montoUsd` guardado (pagos y cobros) ya trae su equivalente; los demás lo reciben aquí, a la
 * tasa vigente (Binance de preferencia) en el momento en que se registraron.
 */
import { equivalenteUsd, type TasaHistorica } from './equivalente-usd.js';

export type { TasaHistorica };

export interface MovimientoConEquivalente {
  moneda: string;
  monto: number;
  montoUsd: number | null;
  fecha: string;
  creadoEn: string;
}

export function aplicarEquivalentes<T extends MovimientoConEquivalente>(movimientos: readonly T[], tasas: readonly TasaHistorica[]): T[] {
  return movimientos.map(m => {
    if (m.moneda !== 'VES' || m.montoUsd != null) return m;
    const usd = equivalenteUsd(m.monto, { moneda: m.moneda, monto: m.monto, fecha: m.fecha, creadoEn: m.creadoEn, importeEnMonedaOrigen: true }, tasas);
    return { ...m, equivalenteUsd: usd };
  });
}
