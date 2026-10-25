/** Lógica pura de TablaDatos: orden, agrupación, totales y paginación. Sin React: se prueba desde backend/tests.
 *  Todo devuelve arreglos NUEVOS (nunca muta la entrada). */

import { formatearFecha, formatearNumero } from './formato';
import type { ColumnaCsv, ValorCsv } from './csv';

export type Sentido = 'asc' | 'desc';

export interface OrdenTabla {
  /** Clave de la columna ordenada, o null si no hay orden (se respeta el orden de origen). */
  columna: string | null;
  sentido: Sentido;
}

export const SIN_ORDEN: OrdenTabla = { columna: null, sentido: 'asc' };

export type ValorOrden = string | number | boolean | Date | null | undefined;

export interface ColumnaTabla<T> {
  /** Identificador único de la columna (también la clave de orden). */
  clave: string;
  titulo: string;
  /** Alineación; las cifras van a la derecha. */
  alinear?: 'izquierda' | 'derecha';
  /** Celda en pantalla. Por defecto muestra valorOrden/valorCsv. */
  celda?: (fila: T) => unknown;
  /** Valor usado para ordenar (y para la celda si no hay `celda`). Sin esta función la columna no ordena. */
  valorOrden?: (fila: T) => ValorOrden;
  /** Valor exportado al CSV; si falta se usa valorOrden. Con `false` la columna no se exporta. */
  valorCsv?: ((fila: T) => ValorOrden) | false;
  /** Decimales del CSV para valores numéricos. */
  decimalesCsv?: number;
  /** Suma de la columna para la fila de totales. */
  total?: (filas: readonly T[]) => unknown;
  /** Explicación breve (muestra un "?" en el encabezado). */
  ayuda?: string;
  /** Oculta la columna en la vista de tarjetas móviles. */
  ocultaEnMovil?: boolean;
  /** Clases extra del encabezado/celdas (anchos, nowrap). */
  claseCelda?: string;
}

/** Siguiente orden al pulsar un encabezado: sin orden -> asc -> desc -> sin orden (otra columna arranca en asc). */
export function alternarOrden(actual: OrdenTabla, columna: string): OrdenTabla {
  if (actual.columna !== columna) return { columna, sentido: 'asc' };
  if (actual.sentido === 'asc') return { columna, sentido: 'desc' };
  return SIN_ORDEN;
}

export function ariaSort(orden: OrdenTabla, columna: string): 'ascending' | 'descending' | 'none' {
  if (orden.columna !== columna) return 'none';
  return orden.sentido === 'asc' ? 'ascending' : 'descending';
}

const vacio = (v: ValorOrden): v is null | undefined => v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));

const aComparable = (v: Exclude<ValorOrden, null | undefined>): number | string => {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
};

/** Compara dos valores en orden ascendente. Los vacíos (null/undefined/NaN) van SIEMPRE al final (lo resuelve ordenarFilas). */
export function compararValores(a: ValorOrden, b: ValorOrden): number {
  if (vacio(a) && vacio(b)) return 0;
  if (vacio(a)) return 1;
  if (vacio(b)) return -1;
  const x = aComparable(a);
  const y = aComparable(b);
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  return String(x).localeCompare(String(y), 'es', { numeric: true, sensitivity: 'base' });
}

/** Orden estable por una columna. Los vacíos quedan al final en ambos sentidos. Sin columna u orden: copia tal cual. */
export function ordenarFilas<T>(filas: readonly T[], orden: OrdenTabla, columnas: ReadonlyArray<ColumnaTabla<T>>): T[] {
  const col = orden.columna ? columnas.find(c => c.clave === orden.columna) : undefined;
  const valor = col?.valorOrden;
  if (!valor) return [...filas];
  const signo = orden.sentido === 'asc' ? 1 : -1;
  return filas
    .map((fila, indice) => ({ fila, indice, v: valor(fila) }))
    .sort((p, q) => {
      const pv = vacio(p.v);
      const qv = vacio(q.v);
      if (pv || qv) return pv && qv ? p.indice - q.indice : pv ? 1 : -1;
      return signo * compararValores(p.v, q.v) || p.indice - q.indice;
    })
    .map(p => p.fila);
}

export interface GrupoFilas<T> {
  clave: string;
  titulo: string;
  filas: T[];
}

export interface DefinicionGrupo<T> {
  /** Clave del grupo al que pertenece la fila. */
  clave: (fila: T) => string;
  /** Texto del encabezado del grupo (por defecto la clave). */
  titulo?: (clave: string) => string;
  /** Orden de los grupos entre sí (por defecto, el de primera aparición). */
  ordenGrupos?: (a: GrupoFilas<T>, b: GrupoFilas<T>) => number;
}

/** Agrupa conservando el orden de primera aparición de cada grupo y el orden interno de las filas. */
export function agruparFilas<T>(filas: readonly T[], def: DefinicionGrupo<T>): Array<GrupoFilas<T>> {
  const grupos = new Map<string, GrupoFilas<T>>();
  for (const fila of filas) {
    const clave = def.clave(fila);
    let g = grupos.get(clave);
    if (!g) {
      g = { clave, titulo: def.titulo ? def.titulo(clave) : clave, filas: [] };
      grupos.set(clave, g);
    }
    g.filas.push(fila);
  }
  return [...grupos.values()];
}

/** Suma segura: ignora vacíos y no finitos. */
export function sumar(valores: ReadonlyArray<number | null | undefined>): number {
  let t = 0;
  for (const v of valores) if (typeof v === 'number' && Number.isFinite(v)) t += v;
  return t;
}

export interface Pagina<T> {
  filas: T[];
  /** Página actual (1 en adelante), ya acotada al rango válido. */
  pagina: number;
  paginas: number;
  total: number;
  /** Índices 1-based "mostrando del X al Y". */
  desde: number;
  hasta: number;
}

export function paginar<T>(filas: readonly T[], pagina: number, tamano: number): Pagina<T> {
  const t = Math.max(1, Math.floor(tamano) || 1);
  const total = filas.length;
  const paginas = Math.max(1, Math.ceil(total / t));
  const p = Math.min(paginas, Math.max(1, Math.floor(pagina) || 1));
  const ini = (p - 1) * t;
  const pedazo = filas.slice(ini, ini + t);
  return { filas: pedazo, pagina: p, paginas, total, desde: total === 0 ? 0 : ini + 1, hasta: ini + pedazo.length };
}

/** Texto por defecto de una celda sin render propio: número es-VE, fecha dd/mm/aaaa, vacío "—". */
export function valorATexto(v: unknown): string {
  if (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) return '—';
  if (typeof v === 'number') return formatearNumero(v, Number.isInteger(v) ? 0 : 2);
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (v instanceof Date) return formatearFecha(v);
  return String(v);
}

/** Ordena filas DENTRO de cada grupo (no mueve filas entre grupos) y, si se pide, ordena los grupos entre sí.
 *  Sin `ordenGrupos` los grupos conservan su orden de primera aparición. */
export function ordenarGrupos<T>(
  grupos: ReadonlyArray<GrupoFilas<T>>,
  orden: OrdenTabla,
  columnas: ReadonlyArray<ColumnaTabla<T>>,
  ordenGrupos?: (a: GrupoFilas<T>, b: GrupoFilas<T>) => number,
): Array<GrupoFilas<T>> {
  const conFilasOrdenadas = grupos.map(g => ({ ...g, filas: ordenarFilas(g.filas, orden, columnas) }));
  return ordenGrupos ? [...conFilasOrdenadas].sort(ordenGrupos) : conFilasOrdenadas;
}

/** Columnas que se exportan al CSV (con valor de exportación y sin `valorCsv: false`). */
export function columnasParaCsv<T>(columnas: ReadonlyArray<ColumnaTabla<T>>): Array<ColumnaCsv<T>> {
  const salida: Array<ColumnaCsv<T>> = [];
  for (const c of columnas) {
    if (c.valorCsv === false) continue;
    const valor = c.valorCsv ?? c.valorOrden;
    if (!valor) continue;
    salida.push({ titulo: c.titulo, valor: valor as (f: T) => ValorCsv, decimales: c.decimalesCsv });
  }
  return salida;
}
