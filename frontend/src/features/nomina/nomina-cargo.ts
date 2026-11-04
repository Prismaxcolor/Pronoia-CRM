/**
 * Textos del «cargo del trabajador» y del equivalente en USD de los pagos en Bs (lógica pura, sin React).
 * Regla: todo movimiento en Bs se muestra con su equivalente en USD a la tasa Binance del mediodía (Caracas) del día del
 * pago, congelada al pagar. Si ese día no había captura al mediodía se usó la anterior más cercana y se dice cuál.
 */
import type { CargoTrabajador, MovimientoCargo } from '../../../../shared/types/nomina.js';
import { diaNegocio, formatearFechaHora } from '../../lib/fecha-negocio';
import { formatearFecha, formatearNumero } from '../../lib/formato';

export const TEXTO_SIN_TASA_BINANCE = 'Sin tasa Binance registrada para ese día';

interface DatosTasa {
  tasaBinance: number | null;
  tasaBinanceCapturada: string | null;
}

/** «Tasa Binance 875,60 (captura 09/10/2026 11:42)»; si la captura no es del día del pago, se avisa. null sin tasa. */
export function textoTasaBinance(d: DatosTasa, fechaPago: string): string | null {
  if (d.tasaBinance === null) return null;
  const base = `Tasa Binance ${formatearNumero(d.tasaBinance, 2)}`;
  if (d.tasaBinanceCapturada === null) return base;
  const mismoDia = diaNegocio(d.tasaBinanceCapturada) === fechaPago;
  return `${base} (captura ${formatearFechaHora(d.tasaBinanceCapturada)}${mismoDia ? '' : ', anterior más cercana: no hay captura del día del pago'})`;
}

/** «≈ USD 2,28» del equivalente congelado; null si no hay. */
export function textoEquivalenteUsd(equivalenteUsd: number | null): string | null {
  return equivalenteUsd == null ? null : `≈ USD ${formatearNumero(equivalenteUsd, 2)}`;
}

/** Pago en Bs ya hecho: «≈ USD 2,28 · Tasa Binance 875,60 (captura …)» o el aviso de que no hay tasa. */
export function textoEquivalenteDePago(
  p: DatosTasa & { equivalenteBinanceUsd: number | null; fecha: string },
): string {
  const eq = textoEquivalenteUsd(p.equivalenteBinanceUsd);
  const tasa = textoTasaBinance(p, p.fecha);
  return eq && tasa ? `${eq} · ${tasa}` : TEXTO_SIN_TASA_BINANCE;
}

/** Monto del movimiento tal como se muestra: «Bs 2.000,00» o «USD 100,00». */
export function textoMontoMovimiento(m: Pick<MovimientoCargo, 'montoBs' | 'montoUsd'>): string {
  if (m.montoBs !== null) return `Bs ${formatearNumero(m.montoBs, 2)}`;
  return `USD ${formatearNumero(m.montoUsd ?? 0, 2)}`;
}

/** Detalle de un movimiento en Bs: su equivalente en USD y la tasa usada; vacío para movimientos en USD. */
export function textoDetalleBs(m: MovimientoCargo): string | null {
  if (m.montoBs === null) return null;
  if (m.estado === 'PENDIENTE') return 'Aún sin pagar: el equivalente se fija al pagar';
  if (m.estado === 'ANULADO') return null;
  const eq = textoEquivalenteUsd(m.equivalenteUsd);
  const tasa = textoTasaBinance(m, m.fecha);
  return eq && tasa ? `${eq} · ${tasa}` : TEXTO_SIN_TASA_BINANCE;
}

export function textoFechaMovimiento(m: Pick<MovimientoCargo, 'fecha'>): string {
  return formatearFecha(m.fecha);
}

/** Resumen de una línea del cargo para listas y pruebas: «05/10/2026 · Pago de nómina en bolívares · Bs 2.000,00». */
export function resumenMovimiento(m: MovimientoCargo, etiquetaTipo: string): string {
  return `${textoFechaMovimiento(m)} · ${etiquetaTipo} · ${m.concepto} · ${textoMontoMovimiento(m)}`;
}

/** ¿Hay algo que mostrar? Un trabajador sin movimientos ni préstamos vigentes muestra el estado vacío. */
export function cargoVacio(c: Pick<CargoTrabajador, 'movimientos'>): boolean {
  return c.movimientos.length === 0;
}
