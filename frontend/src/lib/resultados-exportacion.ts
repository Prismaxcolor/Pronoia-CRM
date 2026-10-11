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
