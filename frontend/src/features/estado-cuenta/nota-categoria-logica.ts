/** Lógica pura de la categoría en las notas de crédito/débito (sin React). Se prueba en backend/tests/nota-categoria-logica.test.ts. */

import type { CategoriaWallet } from '@shared/types/index.js';
import { armarArbol } from '../cochinito/categorias/categorias-logica';

/**
 * El id solo si todavía se puede elegir para una nota (categoría o subcategoría activa, con su categoría activa);
 * null si no hay, ya no existe o está archivada. Sirve para no restaurar de un borrador ni enviar una categoría vencida.
 * Una nota no tiene tipo de movimiento: cualquier tipo de categoría sirve.
 */
export function categoriaElegibleParaNota(id: string | null | undefined, categorias: readonly CategoriaWallet[]): string | null {
  if (!id) return null;
  const elegible = armarArbol(categorias, false).some(n => n.categoria.id === id || n.hijas.some(h => h.id === id));
  return elegible ? id : null;
}
