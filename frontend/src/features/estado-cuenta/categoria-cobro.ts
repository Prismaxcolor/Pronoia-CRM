import type { CategoriaWallet } from '@shared/types/index.js';

/**
 * Lógica pura de la categoría del Wallet al registrar un cobro a cliente. El backend ofrece solo las categorías
 * del uso "cobro_cliente" (venta de chatarra NF o PCB). Si no hay ninguna, el cobro no pide categoría.
 * Un cruce puro (sin movimiento de dinero) tampoco la lleva.
 */

/** Opciones vigentes que admiten ingresos (el backend ya filtra; esto protege ante una respuesta con archivadas). */
export function opcionesDeCobro(categorias: readonly CategoriaWallet[]): CategoriaWallet[] {
  return categorias.filter(c => c.activo && c.tipo !== 'EGRESO');
}

/** True si el formulario debe pedir la categoría: hay opciones y el cobro mueve dinero. */
export function cobroPideCategoria(opciones: readonly CategoriaWallet[], hayDinero: boolean): boolean {
  return hayDinero && opciones.length > 0;
}

/** Mensaje de error si falta elegir (o la elegida no es una opción); null si todo está bien. */
export function errorCategoriaCobro(
  opciones: readonly CategoriaWallet[],
  elegidaId: string | null,
  hayDinero: boolean
): string | null {
  if (!cobroPideCategoria(opciones, hayDinero)) return null;
  if (elegidaId && opciones.some(c => c.id === elegidaId)) return null;
  return `Elige la categoría del cobro: ${opciones.map(c => c.nombre).join(' o ')}.`;
}

/** Categoría que se envía al backend: null si no aplica (sin opciones o cruce puro). */
export function categoriaParaEnviar(
  opciones: readonly CategoriaWallet[],
  elegidaId: string | null,
  hayDinero: boolean
): string | null {
  if (!cobroPideCategoria(opciones, hayDinero)) return null;
  return opciones.some(c => c.id === elegidaId) ? elegidaId : null;
}

/**
 * True si no se puede registrar un cobro con dinero porque las categorías aún no cargaron o la carga falló:
 * sin ellas no se sabría si hay que pedir categoría (se registraría el ingreso sin categoría por error).
 */
export function categoriasBloqueanCobro(estado: { cargando: boolean; fallo: boolean }, hayDinero: boolean): boolean {
  return hayDinero && (estado.cargando || estado.fallo);
}
