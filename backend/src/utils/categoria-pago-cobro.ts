/**
 * Reglas puras de la categoría del Wallet en pagos a proveedor y cobros a cliente (sin BD).
 * Pago: categoría fija (uso `pago_proveedor`), se aplica sola. Cobro: el usuario elige entre las
 * categorías del uso `cobro_cliente`, obligatoria solo si el cobro mueve dinero.
 * Ver docs/DISENO_wallet_categorias.md y docs/migration_categorias_uso.sql.
 */
import { tipoAceptaMovimiento, type CategoriaFila } from './categoria-wallet.js';

export const MENSAJE_COBRO_SIN_CATEGORIA = 'Elige la categoría del cobro (venta de chatarra NF o PCB).';
export const MENSAJE_COBRO_CATEGORIA_INVALIDA = 'La categoría elegida no es válida para un cobro de cliente.';

/** Categorías que sirven para un egreso (pago a proveedor) o un ingreso (cobro a cliente). */
export function categoriasParaTipo<T extends CategoriaFila>(categorias: readonly T[], tipo: 'egreso' | 'ingreso'): T[] {
  return categorias.filter(c => tipoAceptaMovimiento(c.tipo, tipo));
}

/**
 * Agrega a las categorías asignadas al cobro las subcategorías vigentes de las que son categoría general
 * (y admiten ingresos), para poder elegir tanto la categoría general como una subcategoría suya.
 */
export function conSubcategoriasDeCobro<T extends CategoriaFila>(asignadas: readonly T[], todas: readonly T[], tipo: 'egreso' | 'ingreso' = 'ingreso'): T[] {
  const ids = new Set(asignadas.map(c => c.id));
  const padres = new Set(asignadas.filter(c => c.padreId === null).map(c => c.id));
  const hijas = todas.filter(c => c.activo && c.padreId !== null && padres.has(c.padreId) && !ids.has(c.id));
  return [...asignadas, ...categoriasParaTipo(hijas, tipo)];
}

/** Id de la categoría fija de los pagos: la primera vigente que admite egresos; null si no hay. */
export function elegirCategoriaDePago(categorias: readonly CategoriaFila[]): string | null {
  return categoriasParaTipo(categorias, 'egreso')[0]?.id ?? null;
}

export type ResolucionCategoriaCobro = { categoriaId: string | null } | { error: string };

/**
 * Categoría con la que se registra un cobro. Sin opciones configuradas el cobro va sin categoría (como antes)
 * y se ignora lo que mande el cliente. Con opciones, un cobro que mueve dinero exige una de ellas;
 * un cruce puro (sin dinero) no lleva categoría.
 */
export function resolverCategoriaDeCobro(
  opciones: readonly CategoriaFila[],
  categoriaId: string | null | undefined,
  hayDinero: boolean
): ResolucionCategoriaCobro {
  const validas = categoriasParaTipo(opciones, 'ingreso');
  if (!hayDinero || validas.length === 0) return { categoriaId: null };
  if (!categoriaId) return { error: MENSAJE_COBRO_SIN_CATEGORIA };
  if (!validas.some(c => c.id === categoriaId)) return { error: MENSAJE_COBRO_CATEGORIA_INVALIDA };
  return { categoriaId };
}

export const MENSAJE_PAGO_CATEGORIA_INVALIDA = 'La categoría elegida no es válida para un pago a proveedor.';

/**
 * Categoría con la que se registra un pago: la elegida si es una de las opciones permitidas (egresos);
 * si no se eligió ninguna, la fija por configuración (puede ser null). Una elegida fuera de las opciones se rechaza.
 */
export function resolverCategoriaDePago(
  opciones: readonly CategoriaFila[],
  elegidaId: string | null | undefined,
  fijaId: string | null
): ResolucionCategoriaCobro {
  if (!elegidaId) return { categoriaId: fijaId };
  if (!categoriasParaTipo(opciones, 'egreso').some(c => c.id === elegidaId)) return { error: MENSAJE_PAGO_CATEGORIA_INVALIDA };
  return { categoriaId: elegidaId };
}
