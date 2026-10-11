/**
 * Reglas puras de las categorías del Wallet (sin BD). La BD repite las mismas reglas con triggers
 * (docs/migration_wallet_categorias.sql); aquí se validan antes para dar mensajes claros.
 * Dos niveles: categoría (padreId null) y subcategoría (su padre es una categoría).
 */

export type TipoCategoria = 'INGRESO' | 'EGRESO' | 'AMBOS';
export type TipoMovimientoWallet = 'ingreso' | 'egreso' | 'transferencia';

/** Fila de categoría con lo que las reglas necesitan. */
export interface CategoriaFila {
  id: string;
  nombre: string;
  tipo: TipoCategoria;
  color: string;
  padreId: string | null;
  activo: boolean;
}

const PATRON_HEX = /^#[0-9A-F]{6}$/;

/** Recorta y pasa a mayúsculas el hex de entrada (cualquier otro texto queda igual y falla la validación). */
export function normalizarColorCategoria(valor: string): string {
  return valor.trim().toUpperCase();
}

export function esColorCategoriaValido(valor: string): boolean {
  return PATRON_HEX.test(valor);
}

/** True si una categoría de ese tipo se puede poner a un movimiento de ese tipo. Las transferencias no llevan categoría. */
export function tipoAceptaMovimiento(tipo: TipoCategoria, movimiento: TipoMovimientoWallet): boolean {
  if (movimiento === 'transferencia') return false;
  return tipo === 'AMBOS' || (tipo === 'INGRESO' ? movimiento === 'ingreso' : movimiento === 'egreso');
}

const TEXTO_TIPO_CATEGORIA: Record<TipoCategoria, string> = { INGRESO: 'ingresos', EGRESO: 'egresos', AMBOS: 'ingresos y egresos' };

/** Mensaje de rechazo si la categoría no sirve para el movimiento; null si sirve (o si no hay categoría). */
export function validarCategoriaParaMovimiento(
  categoriaId: string | null,
  categorias: readonly CategoriaFila[],
  tipoMovimiento: TipoMovimientoWallet
): string | null {
  if (categoriaId === null) return null;
  if (tipoMovimiento === 'transferencia') return 'Las transferencias no llevan categoría.';
  const categoria = categorias.find(c => c.id === categoriaId);
  if (!categoria) return 'La categoría elegida no existe.';
  const padre = categoria.padreId ? categorias.find(c => c.id === categoria.padreId) : null;
  if (!categoria.activo || (padre && !padre.activo)) return 'La categoría elegida está archivada.';
  if (!tipoAceptaMovimiento(categoria.tipo, tipoMovimiento)) {
    return `La categoría "${categoria.nombre}" es solo para ${TEXTO_TIPO_CATEGORIA[categoria.tipo]}.`;
  }
  return null;
}

/** True si una subcategoría de tipo `hijo` cabe bajo una categoría de tipo `padre` (el hijo no puede ser más amplio). */
export function tipoHijoCabeEnPadre(padre: TipoCategoria, hijo: TipoCategoria): boolean {
  return padre === 'AMBOS' || padre === hijo;
}

/** Mensaje de rechazo si `padreId` no puede ser padre de una categoría de tipo `tipoHijo`; null si es válido. */
export function validarPadreDeCategoria(
  padreId: string | null,
  tipoHijo: TipoCategoria,
  categorias: readonly CategoriaFila[]
): string | null {
  if (padreId === null) return null;
  const padre = categorias.find(c => c.id === padreId);
  if (!padre) return 'La categoría padre no existe.';
  if (padre.padreId !== null) return 'Solo hay dos niveles: una subcategoría no puede tener subcategorías.';
  if (!padre.activo) return 'La categoría padre está archivada.';
  if (!tipoHijoCabeEnPadre(padre.tipo, tipoHijo)) {
    return `El tipo de la subcategoría debe coincidir con el de "${padre.nombre}" (${TEXTO_TIPO_CATEGORIA[padre.tipo]}).`;
  }
  return null;
}

/**
 * Ids de categoría que incluye una selección: una categoría arrastra sus subcategorías; una subcategoría
 * va sola. Lista vacía = sin restricción (null). Ids que no existen se ignoran.
 */
export function resolverSeleccion(ids: readonly string[], categorias: readonly CategoriaFila[]): ReadonlySet<string> | null {
  if (ids.length === 0) return null;
  const incluidas = new Set<string>();
  for (const id of ids) {
    const c = categorias.find(x => x.id === id);
    if (!c) continue;
    incluidas.add(c.id);
    if (c.padreId === null) categorias.filter(h => h.padreId === c.id).forEach(h => incluidas.add(h.id));
  }
  return incluidas;
}

/** "Servicios › Luz" para una subcategoría, "Servicios" para una categoría; null si no hay o no existe. */
export function nombreCompletoCategoria(id: string | null, categorias: readonly CategoriaFila[]): string | null {
  const c = id ? categorias.find(x => x.id === id) : undefined;
  if (!c) return null;
  const padre = c.padreId ? categorias.find(x => x.id === c.padreId) : undefined;
  return padre ? `${padre.nombre} › ${c.nombre}` : c.nombre;
}
