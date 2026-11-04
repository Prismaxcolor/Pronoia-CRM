/**
 * Orden de las bancas elegido por cada persona (lógica pura; el guardado vive en useOrdenBancas).
 * El orden es una lista de ids: las bancas que no aparecen en ella (nuevas) van al final en su orden de origen,
 * y los ids de bancas que ya no existen se ignoran.
 */
import type { Banca } from '@shared/types/index.js';

/** Bancas ordenadas según `orden`; las que no están en la lista conservan su orden relativo al final. No muta la entrada. */
export function ordenarBancas<T extends Pick<Banca, 'id'>>(bancas: readonly T[], orden: readonly string[]): T[] {
  const posicion = new Map(orden.map((id, i) => [id, i]));
  return bancas
    .map((b, i) => ({ b, i }))
    .sort((x, y) => (posicion.get(x.b.id) ?? Infinity) - (posicion.get(y.b.id) ?? Infinity) || x.i - y.i)
    .map(({ b }) => b);
}

/** Lista de ids con `id` movido `desplazamiento` posiciones (-1 = antes, +1 = después); no sale de los extremos. No muta la entrada. */
export function moverEnOrden(ids: readonly string[], id: string, desplazamiento: number): string[] {
  const desde = ids.indexOf(id);
  if (desde === -1) return [...ids];
  const hasta = Math.min(ids.length - 1, Math.max(0, desde + desplazamiento));
  if (hasta === desde) return [...ids];
  const copia = [...ids];
  copia.splice(desde, 1);
  copia.splice(hasta, 0, id);
  return copia;
}

/** Texto guardado -> lista de ids (ignora cualquier cosa que no sea una lista de textos). */
export function leerOrdenGuardado(texto: string | null): string[] {
  if (!texto) return [];
  try {
    const dato: unknown = JSON.parse(texto);
    return Array.isArray(dato) ? dato.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Clave de almacenamiento: una por persona, para que dos usuarios del mismo equipo no se pisen. */
export const claveOrdenBancas = (usuarioId: string): string => `pronoia:orden-bancas:${usuarioId}`;
