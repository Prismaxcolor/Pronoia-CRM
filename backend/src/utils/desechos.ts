import { normalizarTexto } from './inventario-vistas.js';

/** El único producto que se puede "vaciar" (basura que se lleva al vertedero). */
export const NOMBRE_PRODUCTO_DESECHOS = 'desechos';

export const esProductoDesechos = (nombre: string | null | undefined): boolean =>
  normalizarTexto(nombre) === NOMBRE_PRODUCTO_DESECHOS;

export interface VaciadoAlmacen {
  almacenId: string;
  kg: number;
}

/** Normaliza el jsonb que devuelve vaciar_desechos(): [{almacen_id, kg}]. Ignora filas inválidas. */
export function leerVaciados(raw: unknown): VaciadoAlmacen[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(r => {
    const fila = r as { almacen_id?: unknown; kg?: unknown };
    const kg = Number(fila.kg);
    return typeof fila.almacen_id === 'string' && Number.isFinite(kg) && kg > 0
      ? [{ almacenId: fila.almacen_id, kg }]
      : [];
  });
}

export const sumarKg = (vaciados: readonly VaciadoAlmacen[]): number =>
  Math.round(vaciados.reduce((acc, v) => acc + v.kg, 0) * 1000) / 1000;
