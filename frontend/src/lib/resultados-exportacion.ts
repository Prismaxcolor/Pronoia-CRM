import { redondear2 } from './packing-list';
import type { KgLote } from './proyeccion-packing';

/**
 * Resultados de la exportación (interno): compara la proyección (USD/kg estimado) con lo realmente
 * obtenido (USD/kg real), por lote y en total. Pura. Nunca inventa cifras: si falta un valor, la
 * celda queda en null y el lote no entra en el total comparativo.
 */

type ValoresPorLote = Readonly<Record<string, number | null | undefined>>;

export interface LineaResultado extends KgLote {
  valorEstimadoKgUsd: number | null;
  valorRealKgUsd: number | null;
  estimadoUsd: number | null;
  realUsd: number | null;
  /** Real − estimado; null si falta alguno de los dos valores. */
  diferenciaUsd: number | null;
  /** Diferencia sobre el estimado; null si falta un valor o el estimado es 0. */
  diferenciaPct: number | null;
}

export interface ResumenResultados {
  lineas: LineaResultado[];
  /** Lotes con estimado y real: los únicos que suman en el total comparativo. */
  lotesComparados: number;
  /** Lotes a los que les falta el estimado o el real. */
  lotesIncompletos: number;
  totalEstimadoUsd: number | null;
  totalRealUsd: number | null;
  diferenciaUsd: number | null;
  diferenciaPct: number | null;
}

const totalLote = (kg: number, valor: number | null): number | null => (valor === null ? null : redondear2(kg * valor));

const porcentaje = (diferencia: number, base: number): number | null =>
  base === 0 ? null : redondear2((diferencia / base) * 100);

function armarLinea({ lote, kg }: KgLote, estimados: ValoresPorLote, reales: ValoresPorLote): LineaResultado {
  const valorEstimadoKgUsd = estimados[lote] ?? null;
  const valorRealKgUsd = reales[lote] ?? null;
  const estimadoUsd = totalLote(kg, valorEstimadoKgUsd);
  const realUsd = totalLote(kg, valorRealKgUsd);
  const completo = estimadoUsd !== null && realUsd !== null;
  const diferenciaUsd = completo ? redondear2(realUsd - estimadoUsd) : null;
  return {
    lote, kg, valorEstimadoKgUsd, valorRealKgUsd, estimadoUsd, realUsd, diferenciaUsd,
    diferenciaPct: diferenciaUsd === null || estimadoUsd === null ? null : porcentaje(diferenciaUsd, estimadoUsd),
  };
}

export function calcularResultados(kgs: readonly KgLote[], estimados: ValoresPorLote, reales: ValoresPorLote): ResumenResultados {
  const lineas = kgs.map(k => armarLinea(k, estimados, reales));
  const comparables = lineas.filter(l => l.estimadoUsd !== null && l.realUsd !== null);
  if (comparables.length === 0) {
    return { lineas, lotesComparados: 0, lotesIncompletos: lineas.length, totalEstimadoUsd: null, totalRealUsd: null, diferenciaUsd: null, diferenciaPct: null };
  }
  const totalEstimadoUsd = redondear2(comparables.reduce((s, l) => s + (l.estimadoUsd ?? 0), 0));
  const totalRealUsd = redondear2(comparables.reduce((s, l) => s + (l.realUsd ?? 0), 0));
  const diferenciaUsd = redondear2(totalRealUsd - totalEstimadoUsd);
  return {
    lineas,
    lotesComparados: comparables.length,
    lotesIncompletos: lineas.length - comparables.length,
    totalEstimadoUsd,
    totalRealUsd,
    diferenciaUsd,
    diferenciaPct: porcentaje(diferenciaUsd, totalEstimadoUsd),
  };
}

/** Aviso bajo la comparación total: cuántos lotes entran y cuántos quedan fuera, con singular y plural correctos. */
export function textoComparacionTotal(comparados: number, incompletos: number): string {
  if (comparados === 0) return 'Aún no hay ningún lote con valor estimado y valor real; la comparación total queda en blanco.';
  if (incompletos === 0) return comparados === 1 ? 'El total compara el único lote.' : `El total compara los ${comparados} lotes.`;
  const comp = comparados === 1 ? '1 lote' : `${comparados} lotes`;
  const falta = incompletos === 1 ? '1 lote no tiene valor estimado o real y no se suma.' : `${incompletos} lotes no tienen valor estimado o real y no se suman.`;
  return `El total compara solo ${comp} con ambos valores. ${falta}`;
}

// ---- Total real cobrado de la exportación -----------------------------------------------------------------------
// El beneficio real suele ser un TOTAL cobrado; repartirlo por lote sería inventar números (las líneas de venta no
// llevan lote). Por eso se compara aparte: la proyección total frente a ese total.

const TOPE_TOTAL_USD = 99_999_999_999.99;

export interface ResultadoTotal {
  /** Suma de kg × USD/kg de los lotes que tienen estimado; null si ninguno lo tiene. */
  estimadoUsd: number | null;
  /** Total realmente cobrado (USD) tal como se escribió; null = sin cargar. */
  realUsd: number | null;
  /** Total real − proyección total; null si falta alguno de los dos. */
  diferenciaUsd: number | null;
  /** Diferencia sobre la proyección total; null si falta un dato o la proyección es 0. */
  diferenciaPct: number | null;
  /** Lotes sin valor estimado: la proyección total no los incluye. */
  lotesSinEstimar: number;
}

export function calcularResultadoTotal(
  kgs: readonly KgLote[],
  estimados: ValoresPorLote,
  totalRealUsd: number | null
): ResultadoTotal {
  const conEstimado = kgs.filter(k => estimados[k.lote] != null);
  const estimadoUsd = conEstimado.length === 0
    ? null
    : redondear2(conEstimado.reduce((s, k) => s + k.kg * (estimados[k.lote] ?? 0), 0));
  const diferenciaUsd = estimadoUsd === null || totalRealUsd === null ? null : redondear2(totalRealUsd - estimadoUsd);
  return {
    estimadoUsd,
    realUsd: totalRealUsd,
    diferenciaUsd,
    diferenciaPct: diferenciaUsd === null || estimadoUsd === null ? null : porcentaje(diferenciaUsd, estimadoUsd),
    lotesSinEstimar: kgs.length - conEstimado.length,
  };
}

/** Lee un monto USD escrito a mano ("13.193,46", "13193,46" o "13193.46"), hasta 2 decimales. Vacío o inválido = null. */
export function parsearTotalUsd(texto: string): number | null {
  const t = texto.trim();
  if (t === '') return null;
  const normalizado = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^\d+(\.\d{1,2})?$/.test(normalizado)) return null;
  const n = Number(normalizado);
  return Number.isFinite(n) && n <= TOPE_TOTAL_USD ? n : null;
}

/** 13193.46 -> "13193,46" (el campo se edita como texto con coma decimal); sin valor = vacío. */
export const textoTotalUsd = (n: number | null | undefined): string => (n == null ? '' : String(n).replace('.', ','));
