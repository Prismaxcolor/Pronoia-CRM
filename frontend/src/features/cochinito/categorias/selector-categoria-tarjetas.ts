/** Lógica pura del selector de categorías en tarjetas (sin React). Se prueba en backend/tests/selector-categoria-tarjetas.test.ts. */

import type { CategoriaWallet } from '@shared/types/index.js';
import {
  VALOR_SIN_CATEGORIA, armarArbol, eleccionDeCategoriaId, indicePorId, opcionesParaTipo, type EleccionCategoria,
} from './categorias-logica';

/**
 * Valor que marca el selector de tarjetas para una elección del formulario:
 * '' = aún no eligió (ninguna tarjeta marcada), null = "Sin categoría", si no el id de la subcategoría o categoría.
 */
export function valorTarjetaDeEleccion(e: EleccionCategoria): string | null {
  if (e.categoria === '') return '';
  if (e.categoria === VALOR_SIN_CATEGORIA) return null;
  return e.subcategoria || e.categoria;
}

/** Elección del formulario para la tarjeta tocada (null = "Sin categoría"); una subcategoría arrastra a su categoría. */
export function eleccionDeTarjeta(id: string | null, categorias: readonly CategoriaWallet[]): EleccionCategoria {
  return eleccionDeCategoriaId(id, indicePorId(categorias));
}

/** Id de la tarjeta "Sin categoría" (no es un uuid, así que no choca con una categoría real). */
export const SIN_CATEGORIA_ID = 'sin';

/** Lo que dibuja cada tarjeta: imagen si hay, si no el color con la inicial. El nombre siempre va escrito. */
export interface TarjetaCategoria {
  id: string;
  nombre: string;
  /** Nombre de la categoría padre (solo en subcategorías). */
  padreNombre: string | null;
  /** Id de la categoría padre (solo en subcategorías). */
  padreId: string | null;
  color: string;
  imagenUrl: string | null;
  inicial: string;
}

export interface OpcionesTarjetas {
  /** Deja solo las categorías que aceptan ese tipo de movimiento. */
  tipoMovimiento?: 'ingreso' | 'egreso';
  /** Deja solo estas categorías/subcategorías. */
  soloIds?: readonly string[];
  /** Texto del buscador (nombre propio o de la categoría padre). */
  busqueda?: string;
}

/** Primera letra del nombre (mayúscula) para la tarjeta sin imagen; '?' si no hay nombre. */
export function inicialDeCategoria(nombre: string): string {
  return nombre.trim().charAt(0).toUpperCase() || '?';
}

/** Minúsculas y sin tildes, para que buscar "ajustes" encuentre "Ajústes". */
const normalizar = (texto: string): string => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Tarjetas del selector: solo categorías activas, cada categoría seguida de sus subcategorías (orden por nombre).
 * Una subcategoría cuyo padre está archivado no se ofrece (igual que al registrar un movimiento).
 */
export function tarjetasDeCategorias(categorias: readonly CategoriaWallet[], opciones: OpcionesTarjetas): TarjetaCategoria[] {
  const nodos = opciones.tipoMovimiento ? opcionesParaTipo(categorias, opciones.tipoMovimiento) : armarArbol(categorias, false);
  const permitidas = opciones.soloIds ? new Set(opciones.soloIds) : null;
  const texto = normalizar(opciones.busqueda ?? '');
  return nodos
    .flatMap(n => [{ c: n.categoria, padre: null }, ...n.hijas.map(c => ({ c, padre: n.categoria }))])
    .filter(({ c }) => !permitidas || permitidas.has(c.id))
    .filter(({ c, padre }) => texto === '' || normalizar(c.nombre).includes(texto) || normalizar(padre?.nombre ?? '').includes(texto))
    .map(({ c, padre }) => ({
      id: c.id,
      nombre: c.nombre,
      padreNombre: padre?.nombre ?? null,
      padreId: padre?.id ?? null,
      color: c.color,
      imagenUrl: c.imagenUrl ?? null,
      inicial: inicialDeCategoria(c.nombre),
    }));
}
