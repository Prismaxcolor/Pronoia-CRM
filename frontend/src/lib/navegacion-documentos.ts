/**
 * Navegación anterior / siguiente entre documentos (tickets de pesaje, facturas, pagos, cobros, notas) desde su
 * detalle. «Anterior» es el creado justo antes y «siguiente» el creado justo después, igual que el estado de cuenta.
 */

export interface DestinoVecino {
  to: string;
  /** Estado del enrutador que se conserva al saltar (p. ej. a dónde vuelve el detalle). */
  state?: unknown;
}

export interface VecinosDocumento<T> {
  anterior: T | null;
  siguiente: T | null;
  /** Posición (desde 1) del documento actual en la secuencia; null si no está en ella. */
  posicion: number | null;
  total: number;
}

/** Vecinos del documento que cumple `esActual` dentro de una secuencia ya ordenada del más antiguo al más reciente. */
export function vecinosEnSecuencia<T>(secuencia: readonly T[], esActual: (item: T) => boolean): VecinosDocumento<T> {
  const i = secuencia.findIndex(esActual);
  if (i === -1) return { anterior: null, siguiente: null, posicion: null, total: secuencia.length };
  return { anterior: i > 0 ? secuencia[i - 1] : null, siguiente: i < secuencia.length - 1 ? secuencia[i + 1] : null, posicion: i + 1, total: secuencia.length };
}

export interface ClaveCreacion {
  id: string;
  /** Instante de creación (ISO); sin él, el documento va primero. */
  creadoEn: string | null | undefined;
  /** Correlativo numérico, para desempatar documentos creados en el mismo instante. */
  numero?: number | null;
}

/** Ordena por creación (created_at), luego correlativo y luego id. No muta la entrada. */
export function ordenarPorCreacion<T>(items: readonly T[], clave: (item: T) => ClaveCreacion): T[] {
  const momento = (c: ClaveCreacion): number => {
    const ms = c.creadoEn ? Date.parse(c.creadoEn) : 0;
    return Number.isNaN(ms) ? 0 : ms;
  };
  return [...items].sort((a, b) => {
    const ca = clave(a);
    const cb = clave(b);
    return momento(ca) - momento(cb) || (ca.numero ?? 0) - (cb.numero ?? 0) || ca.id.localeCompare(cb.id);
  });
}

/** Vecinos (por orden de creación) de un documento dentro de una lista cualquiera, ya con la ruta a la que lleva cada uno. */
export function vecinosPorCreacion<T extends { id: string }>(
  items: readonly T[],
  clave: (item: T) => ClaveCreacion,
  idActual: string,
  ruta: (item: T) => string,
  state?: unknown,
): VecinosDocumento<DestinoVecino> {
  const v = vecinosEnSecuencia(ordenarPorCreacion(items, clave), item => item.id === idActual);
  const aDestino = (item: T | null): DestinoVecino | null => (item ? { to: ruta(item), state } : null);
  return { anterior: aDestino(v.anterior), siguiente: aDestino(v.siguiente), posicion: v.posicion, total: v.total };
}
