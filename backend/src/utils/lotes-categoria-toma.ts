/** Qué lotes se ofrecen al contar una categoría "con lote" en una toma física.
 *
 *  No existe un vínculo directo lote-categoría: los lotes se anclan a productos
 *  (producto_lotes) y los productos tienen categoría. Regla (decisión de Julio):
 *    - PGM: SOLO el lote de catalizadores (Lote 4, el polvo que se exporta).
 *    - PCB y las demás categorías con lote: todos los lotes EXCEPTO el de
 *      catalizadores.
 *  Un lote es "de catalizadores" si todos los productos anclados a él son de la
 *  categoría PGM, o si se llama exactamente "LOTE 4" (el mismo nombre que usa
 *  la migración de clasificación de lotes; cubre lotes sin anclajes o con
 *  anclajes mezclados por el relleno inicial de producto_lotes). */

export interface LoteParaToma {
  id: string;
  nombre: string;
  /** Categorías de los productos anclados al lote (producto_lotes). */
  categoriaIdsAncladas: readonly string[];
}

export interface CategoriaParaToma {
  id: string;
  nombre: string;
}

const NOMBRE_LOTE_CATALIZADORES = 'lote 4';
const NOMBRE_CATEGORIA_CATALIZADORES = 'pgm';

const normalizar = (v: string): string =>
  v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export const esCategoriaCatalizadores = (c: CategoriaParaToma): boolean =>
  normalizar(c.nombre) === NOMBRE_CATEGORIA_CATALIZADORES;

export function esLoteCatalizadores(lote: LoteParaToma, categoriaIdsPgm: ReadonlySet<string>): boolean {
  if (normalizar(lote.nombre) === NOMBRE_LOTE_CATALIZADORES) return true;
  return lote.categoriaIdsAncladas.length > 0 && lote.categoriaIdsAncladas.every(id => categoriaIdsPgm.has(id));
}

/** Ids de los lotes que se ofrecen para las categorías elegidas (unión). */
export function lotesElegiblesParaToma(
  lotes: readonly LoteParaToma[],
  categorias: readonly CategoriaParaToma[],
  todasLasCategorias: readonly CategoriaParaToma[] = categorias
): string[] {
  const idsPgm = new Set(todasLasCategorias.filter(esCategoriaCatalizadores).map(c => c.id));
  const quierePgm = categorias.some(esCategoriaCatalizadores);
  const quiereOtras = categorias.some(c => !esCategoriaCatalizadores(c));
  return lotes
    .filter(l => (esLoteCatalizadores(l, idsPgm) ? quierePgm : quiereOtras))
    .map(l => l.id);
}
