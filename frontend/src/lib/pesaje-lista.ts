/** Lógica pura (sin React) de la lista de Tickets de Pesaje: filtros que viven en la URL, filtrado de filas y
 *  orden por columna. Se prueba desde backend/tests/pesaje-kpis.test.ts. */

import type { EsquemaFiltros, ValoresFiltros } from './filtros-url';
import type { OrdenTabla } from './tabla-datos';

export const TIPOS_FILTRO = ['compra', 'venta', 'traslado'] as const;
export const ESTADOS_FILTRO = ['bruto', 'pendiente', 'facturado'] as const;
export type TipoFiltro = (typeof TIPOS_FILTRO)[number];
export type EstadoFiltro = (typeof ESTADOS_FILTRO)[number];

/** Parámetros de URL de la lista: tipo, estado, desde, hasta, entidad, q, dif ("solo diferencia fuera de tolerancia")
 *  y orden ("columna:asc" o "columna:desc"). No hay `rangos`: se puede filtrar solo "desde" o solo "hasta". */
export const ESQUEMA_FILTROS_PESAJE: EsquemaFiltros = {
  campos: {
    tipo: { tipo: 'opcion', opciones: TIPOS_FILTRO },
    estado: { tipo: 'opcion', opciones: ESTADOS_FILTRO },
    desde: { tipo: 'fecha' },
    hasta: { tipo: 'fecha' },
    entidad: { tipo: 'texto' },
    q: { tipo: 'texto' },
    dif: { tipo: 'bandera' },
    orden: { tipo: 'texto' },
  },
};

/** Claves de columna que se pueden ordenar (y guardar en el parámetro `orden` de la URL). */
export const COLUMNAS_ORDENABLES_PESAJE = ['codigo', 'fecha', 'entidad', 'materiales', 'peso', 'diferencia', 'estado', 'facturado'] as const;

/** Claves de URL que pertenecen a la lista (para saber si un enlace directo apunta a Tickets). */
export const CLAVES_FILTROS_PESAJE: readonly string[] = Object.keys(ESQUEMA_FILTROS_PESAJE.campos);

export interface FiltrosPesaje {
  tipo?: TipoFiltro;
  estado?: EstadoFiltro;
  desde?: string;
  hasta?: string;
  entidad?: string;
  q?: string;
  dif: boolean;
}

export function filtrosDeValores(v: ValoresFiltros): FiltrosPesaje {
  const texto = (x: unknown) => (typeof x === 'string' ? x : undefined);
  return {
    tipo: texto(v.tipo) as TipoFiltro | undefined,
    estado: texto(v.estado) as EstadoFiltro | undefined,
    desde: texto(v.desde),
    hasta: texto(v.hasta),
    entidad: texto(v.entidad),
    q: texto(v.q),
    dif: v.dif === true,
  };
}

/** Cuántos filtros hay activos (sin contar el orden). */
export function contarFiltrosPesaje(f: FiltrosPesaje): number {
  return [f.tipo, f.estado, f.desde, f.hasta, f.entidad, f.q].filter(Boolean).length + (f.dif ? 1 : 0);
}

// ---------------------------------------------------------------- orden en la URL

/** "fecha:desc" -> { columna: 'fecha', sentido: 'desc' }. Una columna no listada o un sentido inválido -> sin orden. */
export function ordenDesdeUrl(valor: string | undefined, columnasValidas: readonly string[]): OrdenTabla | null {
  if (!valor) return null;
  const [columna, sentido] = valor.split(':');
  if (!columnasValidas.includes(columna) || (sentido !== 'asc' && sentido !== 'desc')) return null;
  return { columna, sentido };
}

export function ordenAUrl(orden: OrdenTabla): string | undefined {
  return orden.columna ? `${orden.columna}:${orden.sentido}` : undefined;
}

// ---------------------------------------------------------------- filas y filtrado

/** Fila normalizada de la lista (un ticket de compra/venta o un traslado). `origen` guarda el registro original. */
export interface FilaLista<T = unknown> {
  clave: string;
  tipo: 'compra' | 'venta' | 'traslado';
  codigo: string;
  /** AAAA-MM-DD */
  fecha: string | null;
  /** Instante (timestamptz ISO) en que se registró; sirve para mostrar la hora junto a `fecha`. */
  instante?: string;
  entidadId: string | null;
  /** true: ticket en bruto o traslado pendiente (falta confirmarlo). */
  porRecepcionar: boolean;
  /** Solo tickets: true/false según tenga factura; null en traslados, tickets en bruto y tickets unidos (no se facturan). */
  facturado: boolean | null;
  /** Diferencia fuera de tolerancia (ver estadoDiferencia). */
  difFuera: boolean;
  origen: T;
}

/** Aplica los filtros de la URL. `coincideCodigo` se inyecta (shared/types/codigo) para mantener esta lógica sin dependencias. */
export function filtrarFilas<F extends FilaLista>(
  filas: readonly F[],
  f: FiltrosPesaje,
  coincideCodigo: (codigo: string, consulta: string) => boolean,
): F[] {
  return filas.filter(fila => {
    if (f.tipo && fila.tipo !== f.tipo) return false;
    if (f.entidad && fila.entidadId !== f.entidad) return false;
    if (f.q && !coincideCodigo(fila.codigo, f.q)) return false;
    if (f.desde && (!fila.fecha || fila.fecha < f.desde)) return false;
    if (f.hasta && (!fila.fecha || fila.fecha > f.hasta)) return false;
    if (f.dif && !fila.difFuera) return false;
    if (f.estado === 'bruto' && !fila.porRecepcionar) return false;
    if (f.estado === 'pendiente' && fila.facturado !== false) return false;
    if (f.estado === 'facturado' && fila.facturado !== true) return false;
    return true;
  });
}

/** Cuenta cuántas filas hay por estado, con todos los demás filtros ya aplicados (para los números del control de estado). */
export function contarPorEstado(filas: readonly FilaLista[]): { todos: number; bruto: number; pendiente: number; facturado: number } {
  return {
    todos: filas.length,
    bruto: filas.filter(x => x.porRecepcionar).length,
    pendiente: filas.filter(x => x.facturado === false).length,
    facturado: filas.filter(x => x.facturado === true).length,
  };
}
