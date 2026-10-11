/** Lógica pura de las categorías del Wallet (sin React). Se prueba en backend/tests/categorias-logica.test.ts. */

import type { CategoriaWallet, TipoCategoria } from '@shared/types/index.js';
import { PALETA_BANCAS } from '../../../lib/color-banca';
import type { FiltrosCochinito } from '../../../lib/cochinito-kpis';

export const COLOR_CATEGORIA_POR_DEFECTO = '#475569';

/** Colores sugeridos (los mismos de las cuentas, para que todo el Wallet se vea coherente). El color nunca va solo: siempre junto al nombre. */
export const PALETA_CATEGORIAS: ReadonlyArray<{ hex: string; nombre: string }> = PALETA_BANCAS.map(c => ({ hex: c.hex, nombre: c.nombre }));

export const ETIQUETA_TIPO_CATEGORIA: Readonly<Record<TipoCategoria, string>> = {
  INGRESO: 'Ingresos',
  EGRESO: 'Egresos',
  AMBOS: 'Ingresos y egresos',
};

const PATRON_HEX = /^#[0-9A-F]{6}$/i;

export const esHexValido = (v: string): boolean => PATRON_HEX.test(v);

/** Recorta, antepone "#" si falta y pasa a mayúsculas (lo que no sea un hex queda igual, para que falle la validación). */
export function normalizarHex(valor: string): string {
  const v = valor.trim();
  const conAlmohadilla = /^[0-9A-F]{6}$/i.test(v) ? `#${v}` : v;
  return conAlmohadilla.toUpperCase();
}

const UMBRAL_LUMINANCIA = 0.6;

/** Blanco u oscuro, el que se lea mejor sobre ese fondo (luminancia relativa). */
export function colorTextoSobre(hex: string): '#FFFFFF' | '#111827' {
  if (!esHexValido(hex)) return '#111827';
  const canal = (i: number): number => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminancia = 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
  return luminancia > UMBRAL_LUMINANCIA ? '#111827' : '#FFFFFF';
}

export interface NodoCategoria {
  categoria: CategoriaWallet;
  hijas: CategoriaWallet[];
}

const porNombre = (a: CategoriaWallet, b: CategoriaWallet): number => a.nombre.localeCompare(b.nombre, 'es');

/** Árbol de dos niveles ordenado por nombre. Sin `incluirArchivadas` se omiten las archivadas (y las subcategorías de una archivada). */
export function armarArbol(categorias: readonly CategoriaWallet[], incluirArchivadas: boolean): NodoCategoria[] {
  const visible = (c: CategoriaWallet): boolean => incluirArchivadas || c.activo;
  return categorias
    .filter(c => c.padreId === null && visible(c))
    .sort(porNombre)
    .map(categoria => ({
      categoria,
      hijas: categorias.filter(h => h.padreId === categoria.id && visible(h)).sort(porNombre),
    }));
}

export function indicePorId(categorias: readonly CategoriaWallet[]): ReadonlyMap<string, CategoriaWallet> {
  return new Map(categorias.map(c => [c.id, c]));
}

/** "Servicios › Luz" y su color, listos para mostrar; null si no hay categoría o no se conoce. */
export function etiquetaCategoria(id: string | null | undefined, indice: ReadonlyMap<string, CategoriaWallet>): { nombre: string; color: string } | null {
  const c = id ? indice.get(id) : undefined;
  if (!c) return null;
  const padre = c.padreId ? indice.get(c.padreId) : undefined;
  return { nombre: padre ? `${padre.nombre} › ${c.nombre}` : c.nombre, color: c.color };
}

const aceptaMovimiento = (tipo: TipoCategoria, movimiento: 'ingreso' | 'egreso'): boolean =>
  tipo === 'AMBOS' || tipo === (movimiento === 'ingreso' ? 'INGRESO' : 'EGRESO');

/** Opciones del selector al registrar un movimiento: solo categorías y subcategorías activas que aceptan ese tipo. */
export function opcionesParaTipo(categorias: readonly CategoriaWallet[], movimiento: 'ingreso' | 'egreso'): NodoCategoria[] {
  return armarArbol(categorias, false)
    .filter(n => aceptaMovimiento(n.categoria.tipo, movimiento))
    .map(n => ({ ...n, hijas: n.hijas.filter(h => aceptaMovimiento(h.tipo, movimiento)) }));
}

/** Lo que la persona eligió en el formulario. '' = aún no eligió; 'sin' = "Sin categoría" explícito; si no, id de categoría. */
export interface EleccionCategoria {
  categoria: string;
  /** '' = solo la categoría (sin subcategoría). */
  subcategoria: string;
}

export const ELECCION_VACIA: EleccionCategoria = { categoria: '', subcategoria: '' };
export const VALOR_SIN_CATEGORIA = 'sin';

/** Mensaje si falta elegir (no hay valor predeterminado: hay que elegir una categoría o "Sin categoría"); null si ya eligió. */
export function mensajeEleccion(e: EleccionCategoria): string | null {
  return e.categoria === '' ? 'Elige una categoría o marca "Sin categoría".' : null;
}

/** Id de la categoría a guardar: la subcategoría si hay, si no la categoría; null = sin categoría. */
export function categoriaIdDeEleccion(e: EleccionCategoria): string | null {
  if (e.categoria === '' || e.categoria === VALOR_SIN_CATEGORIA) return null;
  return e.subcategoria || e.categoria;
}

/** Elección que representa el estado actual de un movimiento (null = "Sin categoría"). */
export function eleccionDeCategoriaId(id: string | null | undefined, indice: ReadonlyMap<string, CategoriaWallet>): EleccionCategoria {
  const c = id ? indice.get(id) : undefined;
  if (!c) return { categoria: VALOR_SIN_CATEGORIA, subcategoria: '' };
  return c.padreId ? { categoria: c.padreId, subcategoria: c.id } : { categoria: c.id, subcategoria: '' };
}

/**
 * Filtros de la URL (categoria / subcategoria) a lo que entiende filtrarMovimientos.
 * 'sin' = ingresos y egresos sin categoría; una subcategoría filtra solo esa; una categoría incluye sus subcategorías.
 */
export function resolverFiltroCategoria(
  f: { categoria?: string; subcategoria?: string },
  categorias: readonly CategoriaWallet[]
): Pick<FiltrosCochinito, 'categoriaIds' | 'sinCategoria'> {
  if (f.categoria === VALOR_SIN_CATEGORIA) return { sinCategoria: true };
  if (f.subcategoria) return { categoriaIds: new Set([f.subcategoria]) };
  if (!f.categoria) return {};
  const ids = categorias.filter(c => c.id === f.categoria || c.padreId === f.categoria).map(c => c.id);
  return { categoriaIds: new Set(ids) };
}
