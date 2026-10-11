/**
 * Textos del equivalente en USD de montos en bolívares (solo visualización; nunca se guarda).
 * El cálculo vive en shared/types/equivalente-usd (ruta relativa: así también lo cargan los tests del backend).
 */
import { usdDesdeBs, type LineaEquivalente, type TasasUsd, type TasaUsd } from '../../../../shared/types/equivalente-usd.js';
import { formatearNumero } from '../../lib/formato';
import { formatearFechaNegocio } from '../../lib/fecha-negocio';

export interface EstadoTasasUsd {
  tasas: TasasUsd;
  cargando: boolean;
}

export const TASAS_USD_VACIAS: TasasUsd = { binance: null, bcv: null };

/** Tasa del servicio -> tasa de visualización; null si falta o no es un número positivo. */
export function aTasaUsd(t: { tasa: number; fecha: string } | null | undefined): TasaUsd | null {
  if (!t || !Number.isFinite(t.tasa) || t.tasa <= 0) return null;
  return { tasa: t.tasa, fecha: t.fecha };
}

const detalleTasa = (tasa: number, fecha: string): string => `Bs ${formatearNumero(tasa, 2)} por USD · ${formatearFechaNegocio(fecha)}`;

/** "≈ USD 10,00 a tasa Binance (Bs 600,00 por USD · 11/10/2026)" o el aviso de tasa no disponible. */
export function textoLineaEquivalente(l: LineaEquivalente): string {
  if (l.usd === null || l.tasa === null || l.fecha === null) {
    return `Equivalente en USD a tasa ${l.fuente}: tasa no disponible por ahora.`;
  }
  return `≈ USD ${formatearNumero(l.usd, 2)} a tasa ${l.fuente} (${detalleTasa(l.tasa, l.fecha)})`;
}

/** Equivalente de un total en Bs a tasa Binance (saldos de las cuentas en Bs). */
export function textoEquivalenteTotal(totalBs: number, binance: TasaUsd | null): string {
  const usd = usdDesdeBs(totalBs, binance?.tasa);
  if (!binance || usd === null) {
    return 'Equivalente en USD a tasa Binance: tasa no disponible por ahora.';
  }
  return `≈ USD ${formatearNumero(usd, 2)} a tasa Binance (${detalleTasa(binance.tasa, binance.fecha)})`;
}
