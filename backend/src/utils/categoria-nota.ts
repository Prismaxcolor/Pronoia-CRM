/**
 * Reglas puras de la categoría de las notas de crédito/débito (sin BD).
 * Una nota no es un movimiento de dinero: no tiene tipo ingreso/egreso, así que admite cualquier
 * categoría o subcategoría activa, de cualquier tipo. La categoría solo se guarda y se muestra en la nota
 * (no entra a los reportes del Wallet). Ver docs/migration_notas_categoria.sql.
 */
import { nombreCompletoCategoria, type CategoriaFila } from './categoria-wallet.js';

/** Categoría ya resuelta para mostrar en una nota (estado de cuenta, detalle, PDF). */
export interface CategoriaDeNota {
  id: string;
  /** "Categoría › Subcategoría" o solo "Categoría". */
  nombre: string;
  color: string;
  imagenUrl: string | null;
}

export const MENSAJE_CATEGORIA_NOTA_INEXISTENTE = 'La categoría elegida no existe.';
export const MENSAJE_CATEGORIA_NOTA_ARCHIVADA = 'La categoría elegida está archivada.';

/** Mensaje de rechazo si la categoría no sirve para una nota; null si sirve (o si no hay categoría). */
export function validarCategoriaParaNota(
  categoriaId: string | null | undefined,
  categorias: readonly CategoriaFila[]
): string | null {
  if (!categoriaId) return null;
  const categoria = categorias.find(c => c.id === categoriaId);
  if (!categoria) return MENSAJE_CATEGORIA_NOTA_INEXISTENTE;
  const padre = categoria.padreId ? categorias.find(c => c.id === categoria.padreId) : null;
  if (!categoria.activo || (padre && !padre.activo)) return MENSAJE_CATEGORIA_NOTA_ARCHIVADA;
  return null;
}

/**
 * Datos de la categoría de una nota para mostrar. Una categoría archivada después de usarse se sigue mostrando
 * (la nota la conserva). Null si no hay categoría o ya no se encuentra.
 */
export function categoriaParaMostrar(
  categoriaId: string | null | undefined,
  categorias: ReadonlyArray<CategoriaFila & { imagenUrl?: string | null }>
): CategoriaDeNota | null {
  if (!categoriaId) return null;
  const categoria = categorias.find(c => c.id === categoriaId);
  const nombre = nombreCompletoCategoria(categoriaId, categorias);
  if (!categoria || !nombre) return null;
  return { id: categoria.id, nombre, color: categoria.color, imagenUrl: categoria.imagenUrl ?? null };
}
