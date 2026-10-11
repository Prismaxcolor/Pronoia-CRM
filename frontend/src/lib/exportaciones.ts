import type { ProyeccionLotePacking } from '@shared/types/index.js';
import { redondear2 } from './packing-list';
import type { KgLote } from './proyeccion-packing';
import { calcularResultados } from './resultados-exportacion';

/**
 * Estado y totales de una exportación (interno). Todo se deriva de los kg por lote y de la proyección guardada
 * en el packing list: nada de esto se guarda aparte. Lógica pura, sin React.
 */

export type EstadoExportacion = 'borrador' | 'valorada' | 'con_resultado';

export const ETIQUETA_ESTADO: Readonly<Record<EstadoExportacion, string>> = {
  borrador: 'Borrador de valoración',
  valorada: 'Valorada',
  con_resultado: 'Con resultado',
};

export interface TotalesExportacion {
  /** Suma de los lotes con valor estimado; null si ninguno lo tiene. */
  estimadoUsd: number | null;
  /** Suma de los lotes con valor real; null si ninguno lo tiene. */
  realUsd: number | null;
  /** Real menos estimado, solo de los lotes que tienen ambos valores; null si no hay ninguno. */
  diferenciaUsd: number | null;
  /** true = hay valores reales pero faltan datos en algún lote: la diferencia no cubre toda la exportación. */
  parcial: boolean;
}

const porLote = (lineas: readonly ProyeccionLotePacking[], campo: 'valorKgUsd' | 'valorRealKgUsd') =>
  Object.fromEntries(lineas.map(l => [l.lote, l[campo] ?? null]));

/** Sin proyección visible (sin permiso de facturación) no hay estado. */
export function estadoExportacion(
  kgs: readonly KgLote[],
  proyeccion: readonly ProyeccionLotePacking[] | undefined
): EstadoExportacion | null {
  if (!proyeccion) return null;
  const estimados = porLote(proyeccion, 'valorKgUsd');
  const reales = porLote(proyeccion, 'valorRealKgUsd');
  if (kgs.some(k => reales[k.lote] != null)) return 'con_resultado';
  const todosEstimados = kgs.length > 0 && kgs.every(k => estimados[k.lote] != null);
  return todosEstimados ? 'valorada' : 'borrador';
}

const sumaUsd = (kgs: readonly KgLote[], valores: Readonly<Record<string, number | null>>): number | null => {
  const conValor = kgs.filter(k => valores[k.lote] != null);
  if (conValor.length === 0) return null;
  return redondear2(conValor.reduce((s, k) => s + k.kg * (valores[k.lote] ?? 0), 0));
};

export function totalesExportacion(
  kgs: readonly KgLote[],
  proyeccion: readonly ProyeccionLotePacking[] | undefined
): TotalesExportacion {
  if (!proyeccion) return { estimadoUsd: null, realUsd: null, diferenciaUsd: null, parcial: false };
  const estimados = porLote(proyeccion, 'valorKgUsd');
  const reales = porLote(proyeccion, 'valorRealKgUsd');
  const comparacion = calcularResultados(kgs, estimados, reales);
  const realUsd = sumaUsd(kgs, reales);
  return {
    estimadoUsd: sumaUsd(kgs, estimados),
    realUsd,
    diferenciaUsd: comparacion.diferenciaUsd,
    parcial: realUsd !== null && comparacion.lotesIncompletos > 0,
  };
}
