/**
 * Equivalente en USD de montos en bolívares (VES), solo para MOSTRAR: nunca se guarda en la base.
 * Una tasa no disponible devuelve null y la pantalla lo dice; no se inventa ni se reutiliza otra.
 */

export interface TasaUsd {
  /** Bolívares por 1 USD. */
  tasa: number;
  /** Instante en que se registró la tasa (ISO). */
  fecha: string;
}

export interface TasasUsd {
  binance: TasaUsd | null;
  bcv: TasaUsd | null;
}

export type FuenteEquivalente = 'Binance' | 'BCV';

export interface LineaEquivalente {
  fuente: FuenteEquivalente;
  tasa: number | null;
  fecha: string | null;
  usd: number | null;
}

const redondear2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** USD que equivalen a un monto en Bs a la tasa dada; null si la tasa o el monto no son números válidos. */
export function usdDesdeBs(montoBs: number, tasa: number | null | undefined): number | null {
  if (!Number.isFinite(montoBs)) return null;
  if (tasa == null || !Number.isFinite(tasa) || tasa <= 0) return null;
  return redondear2(montoBs / tasa);
}

function linea(fuente: FuenteEquivalente, montoBs: number, t: TasaUsd | null): LineaEquivalente {
  const usd = usdDesdeBs(montoBs, t?.tasa);
  return usd === null ? { fuente, tasa: null, fecha: null, usd: null } : { fuente, tasa: (t as TasaUsd).tasa, fecha: t!.fecha, usd };
}

/** Dos líneas (Binance y BCV) con el equivalente de un monto en Bs; vacío si no hay un monto positivo. */
export function equivalentesDeBs(montoBs: number, tasas: TasasUsd): LineaEquivalente[] {
  if (!Number.isFinite(montoBs) || montoBs <= 0) return [];
  return [linea('Binance', montoBs, tasas.binance), linea('BCV', montoBs, tasas.bcv)];
}
