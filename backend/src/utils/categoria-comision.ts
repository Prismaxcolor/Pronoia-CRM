/**
 * Reglas puras de la categoría de las comisiones bancarias (sin BD).
 * Ver docs/migration_categoria_comisiones_bancarias.sql: todo cargo de comisión bancaria lleva esta categoría.
 */
import type { CategoriaFila } from './categoria-wallet.js';

export const NOMBRE_CATEGORIA_COMISION_BANCARIA = 'COMISIONES BANCARIAS';

const normalizar = (texto: string): string => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();

/** Categoría con ese nombre (sin distinguir mayúsculas, tildes ni espacios sobrantes); la primera si hay varias. */
export function buscarCategoriaPorNombre<T extends CategoriaFila>(categorias: readonly T[], nombre: string): T | null {
  const buscado = normalizar(nombre);
  return categorias.find(c => normalizar(c.nombre) === buscado) ?? null;
}
