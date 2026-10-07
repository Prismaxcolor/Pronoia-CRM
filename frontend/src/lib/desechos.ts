import { normalizarTexto } from './catalogos-kpis';

/** El único producto que tiene la acción "Vaciar desechos" (basura que se lleva al vertedero). */
export const NOMBRE_PRODUCTO_DESECHOS = 'desechos';

export const esProductoDesechos = (nombre: string | null | undefined): boolean =>
  normalizarTexto(nombre ?? '') === NOMBRE_PRODUCTO_DESECHOS;

/** La fila de la tabla de inventario ofrece vaciar solo si es el material DESECHOS y hay kg. */
export function puedeVaciarDesechos(f: { tipo: string; material: string; productoId: string | null; kg: number }): boolean {
  return f.tipo === 'material' && f.productoId !== null && f.kg > 0 && esProductoDesechos(f.material);
}
