/** Lógica pura de las curvas de Estadísticas: comparación de períodos alineada por posición del día, etiquetas del eje X,
 *  y movimiento del cursor/teclado sobre una gráfica. Se prueba en backend/tests/wallet-estadisticas-curvas.test.ts. */

import { formatearFechaCorta } from '../../../lib/formato';
import type { RangoFechas } from '../wallet-periodos';
import { diasEnRango, redondear2, type FlujoPreparado, type Granularidad, type MovUsd } from './estadisticas-logica';

export type MetricaComparacion = 'flujo' | 'gastos' | 'ingresos';

export const METRICAS: ReadonlyArray<{ valor: MetricaComparacion; etiqueta: string }> = [
  { valor: 'flujo', etiqueta: 'Flujo' },
  { valor: 'gastos', etiqueta: 'Gastos' },
  { valor: 'ingresos', etiqueta: 'Ingresos' },
];

const DIA_MS = 86400000;
const aFecha = (iso: string): number => new Date(`${iso}T00:00:00Z`).getTime();
const aIso = (t: number): string => new Date(t).toISOString().slice(0, 10);

/** Valor acumulado de la métrica al final de cada día del rango (largo = días del rango). */
export function acumuladoPorDia(rango: RangoFechas, flujo: Pick<FlujoPreparado, 'ingresos' | 'egresos'>, metrica: MetricaComparacion): number[] {
  const dias = diasEnRango(rango);
  const delDia = new Array<number>(dias).fill(0);
  const sumar = (items: readonly MovUsd[], signo: 1 | -1): void => {
    for (const it of items) {
      const i = Math.round((aFecha(it.dia) - aFecha(rango.desde)) / DIA_MS);
      if (i >= 0 && i < dias) delDia[i] += signo * it.usd;
    }
  };
  if (metrica !== 'gastos') sumar(flujo.ingresos, 1);
  if (metrica !== 'ingresos') sumar(flujo.egresos, metrica === 'flujo' ? -1 : 1);
  let acum = 0;
  return delDia.map(v => { acum = redondear2(acum + v); return acum; });
}

export interface PuntoComparacion {
  indice: number;
  /** Fecha del día en el período actual. */
  dia: string;
  etiqueta: string;
  actual: number;
  /** null = no hay dato para esa posición (la curva no se dibuja ahí; nunca se rellena con ceros). */
  anterior: number | null;
  anioPasado: number | null;
}

export interface SerieComparable {
  rango: RangoFechas;
  flujo: Pick<FlujoPreparado, 'ingresos' | 'egresos'>;
}

export interface EntradaComparacion {
  actual: SerieComparable;
  anterior: SerieComparable | null;
  anioPasado: SerieComparable | null;
  metrica: MetricaComparacion;
}

/** Curvas acumuladas día a día. El día N del período actual se compara con el día N del anterior y del año pasado. */
export function serieComparacion(e: EntradaComparacion): PuntoComparacion[] {
  const base = acumuladoPorDia(e.actual.rango, e.actual.flujo, e.metrica);
  const previa = e.anterior ? acumuladoPorDia(e.anterior.rango, e.anterior.flujo, e.metrica) : null;
  const pasada = e.anioPasado ? acumuladoPorDia(e.anioPasado.rango, e.anioPasado.flujo, e.metrica) : null;
  return base.map((actual, indice) => {
    const dia = aIso(aFecha(e.actual.rango.desde) + indice * DIA_MS);
    return { indice, dia, etiqueta: formatearFechaCorta(dia), actual, anterior: previa?.[indice] ?? null, anioPasado: pasada?.[indice] ?? null };
  });
}

/** Total de la métrica en todo el período (el último valor de la curva acumulada). */
export const totalCurva = (serie: readonly { actual: number }[]): number => (serie.length === 0 ? 0 : serie[serie.length - 1].actual);

export const mismoRango = (a: RangoFechas, b: RangoFechas): boolean => a.desde === b.desde && a.hasta === b.hasta;

// ---------------------------------------------------------------- eje X

/** Índices de las etiquetas del eje X: reparte hasta `max` y siempre incluye el primero y el último (sin que se pisen). */
export function indicesEtiquetasX(n: number, max: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];
  const paso = Math.max(1, Math.ceil((n - 1) / Math.max(1, max - 1)));
  const indices: number[] = [];
  for (let i = 0; i < n - 1; i += paso) indices.push(i);
  if (indices.length > 1 && n - 1 - indices[indices.length - 1] < paso / 2) indices.pop();
  return [...indices, n - 1];
}

const FINAL_HOY: Readonly<Record<Granularidad, string>> = { dia: 'Hoy', semana: 'Esta semana', mes: 'Este mes' };

/** Etiquetas del eje X. Si el rango termina hoy, el último tramo se rotula "Hoy" (o "Esta semana" / "Este mes"). */
export function etiquetasEjeX(etiquetas: readonly string[], granularidad: Granularidad, terminaHoy: boolean): string[] {
  if (!terminaHoy || etiquetas.length === 0) return [...etiquetas];
  return [...etiquetas.slice(0, -1), FINAL_HOY[granularidad]];
}

export const terminaHoy = (rango: RangoFechas, hoy: string): boolean => rango.hasta === hoy;

// ---------------------------------------------------------------- cursor

/** Índice del punto más cercano a una posición horizontal `x` (mismas unidades que `xs`). null si no hay puntos. */
export function indiceBajoCursor(xs: readonly number[], x: number): number | null {
  if (xs.length === 0) return null;
  let mejor = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[mejor] - x)) mejor = i;
  return mejor;
}

/** Índice del cursor tras una tecla: flechas mueven de a uno, Inicio/Fin saltan a los extremos y Escape lo quita. */
export function indiceTrasTecla(indice: number | null, tecla: string, n: number): number | null {
  if (n <= 0) return null;
  if (tecla === 'Escape') return null;
  if (tecla === 'Home') return 0;
  if (tecla === 'End') return n - 1;
  if (tecla === 'ArrowRight' || tecla === 'ArrowUp') return indice === null ? 0 : Math.min(n - 1, indice + 1);
  if (tecla === 'ArrowLeft' || tecla === 'ArrowDown') return indice === null ? n - 1 : Math.max(0, indice - 1);
  return indice;
}

/** Ancho aproximado de un carácter de las etiquetas del eje X (fontSize 11 del viewBox). */
export const ANCHO_CARACTER_ETIQUETA = 6.2;
const SEPARACION_ETIQUETAS = 8;

/** [inicio, fin] horizontal de una etiqueta: la primera se alinea al inicio, la última al final y las demás al centro. */
function extremosEtiqueta(i: number, n: number, etiqueta: string, x: number): [number, number] {
  const ancho = etiqueta.length * ANCHO_CARACTER_ETIQUETA;
  if (i === 0) return [x, x + ancho];
  return i === n - 1 ? [x - ancho, x] : [x - ancho / 2, x + ancho / 2];
}

/** Como `indicesEtiquetasX`, pero descarta las etiquetas intermedias que se pisarían con otra según su texto ("Esta semana"
 *  es más ancha que "11/09"). Siempre conserva la primera y la última. `xs` son los centros de los tramos (unidades del viewBox). */
export function indicesEtiquetasLegibles(etiquetas: readonly string[], xs: readonly number[], max: number): number[] {
  const n = etiquetas.length;
  const base = indicesEtiquetasX(n, max);
  if (base.length <= 2) return base;
  const ext = (i: number): [number, number] => extremosEtiqueta(i, n, etiquetas[i], xs[i]);
  const desdeElFinal: number[] = [n - 1];
  for (let k = base.length - 2; k >= 1; k--) {
    if (ext(base[k])[1] + SEPARACION_ETIQUETAS <= ext(desdeElFinal[desdeElFinal.length - 1])[0]) desdeElFinal.push(base[k]);
  }
  const resultado = [0, ...desdeElFinal.reverse()];
  while (resultado.length > 2 && ext(0)[1] + SEPARACION_ETIQUETAS > ext(resultado[1])[0]) resultado.splice(1, 1);
  return resultado;
}

const TECLAS_DE_CURSOR: ReadonlySet<string> = new Set(['ArrowRight', 'ArrowLeft', 'Home', 'End', 'Escape']);

/** Teclas que mueve el cursor de la gráfica. Arriba y abajo NO: dejan que la página siga desplazándose. */
export const esTeclaDeCursor = (tecla: string): boolean => TECLAS_DE_CURSOR.has(tecla);
