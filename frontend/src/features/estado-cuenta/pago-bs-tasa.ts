/**
 * Lógica pura del bloque "pago desde una cuenta en Bs" del pago a proveedor (sin React): qué tasa se usa para
 * calcular los bolívares (Binance, BCV o manual) y cómo se pide la comisión bancaria. Las tasas Binance y BCV vienen
 * de las que ya carga el Wallet (cochinito/useTasasUsd); la comisión, de cochinito/comision-formulario.
 */
import type { TasasUsd } from '../../../../shared/types/equivalente-usd.js';
import { formatearNumero } from '../../lib/formato';
import { llevaDeOpcion, type OpcionComision } from '../cochinito/comision-formulario';

export type FuenteTasaPago = 'binance' | 'bcv' | 'manual';

export const FUENTES_TASA_PAGO: ReadonlyArray<{ valor: FuenteTasaPago; etiqueta: string }> = [
  { valor: 'binance', etiqueta: 'Binance' },
  { valor: 'bcv', etiqueta: 'BCV' },
  { valor: 'manual', etiqueta: 'Manual' },
];

/** Antes de poder elegir, el pago en Bs usaba la tasa BCV: se conserva como punto de partida. */
export const FUENTE_TASA_PAGO_INICIAL: FuenteTasaPago = 'bcv';

const CENTAVOS = 100;
const redondear2 = (n: number): number => Math.round((n + Number.EPSILON) * CENTAVOS) / CENTAVOS;

/** Bs por USD de la fuente elegida; null si no está disponible o la manual no es un número positivo (no se sustituye por otra). */
export function tasaDePago(fuente: FuenteTasaPago, tasas: TasasUsd, manual: string): number | null {
  if (fuente === 'manual') {
    const valor = Number(manual.trim().replace(',', '.'));
    return manual.trim() !== '' && Number.isFinite(valor) && valor > 0 ? valor : null;
  }
  return tasas[fuente]?.tasa ?? null;
}

/** Bolívares que equivalen a un monto en USD a esa tasa, a centavos; null sin tasa o sin un monto positivo. */
export function montoBsDePago(montoUsd: number, tasa: number | null): number | null {
  if (tasa === null || !Number.isFinite(montoUsd) || montoUsd <= 0) return null;
  return redondear2(montoUsd * tasa);
}

const NOMBRE_FUENTE: Record<FuenteTasaPago, string> = { binance: 'Binance', bcv: 'BCV', manual: 'manual' };

/** Línea de equivalencia "USD 100,00 = Bs 60.000,00 (tasa Binance: Bs 600,00 por USD)" o el aviso de lo que falta. */
export function resumenPagoBs(montoUsd: number, fuente: FuenteTasaPago, tasa: number | null): string {
  if (!(montoUsd > 0)) return '';
  const bs = montoBsDePago(montoUsd, tasa);
  if (bs === null || tasa === null) {
    return fuente === 'manual' ? 'Escribe la tasa manual (Bs por USD).' : `Tasa ${NOMBRE_FUENTE[fuente]} no disponible: elige otra o escribe una tasa manual.`;
  }
  return `USD ${formatearNumero(montoUsd, 2)} = Bs ${formatearNumero(bs, 2)} (tasa ${NOMBRE_FUENTE[fuente]}: Bs ${formatearNumero(tasa, 2)} por USD)`;
}

/** Qué se manda como `llevaComision` de una cuenta: solo en cuentas en Bs con la comisión habilitada y con elección hecha. */
export function llevaComisionDeLinea(opcion: OpcionComision, esBs: boolean, comisionDisponible: boolean): boolean | undefined {
  if (!esBs || !comisionDisponible) return undefined;
  return llevaDeOpcion(opcion) ?? undefined;
}

/** Mensaje si falta responder la pregunta de la comisión en una cuenta en Bs (con la comisión habilitada); null si ya se eligió. */
export function errorEleccionComisionPago(opcion: OpcionComision, nombreCuenta: string): string | null {
  return opcion === '' ? `Indica si el pago desde ${nombreCuenta} lleva comisión bancaria.` : null;
}
