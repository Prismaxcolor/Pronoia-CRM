import { apiFetch } from './api-client';
import type {
  AlertasPantalla,
  CategoriasPantalla,
  DetallePantalla,
  FlujoPantalla,
} from '@shared/types/inventario-pantalla.js';

/** Servicios de los cuatro endpoints de solo lectura de la pantalla nueva de /inventario (contrato:
 *  shared/types/inventario-pantalla.ts). Todos devuelven `{ dato } | { error }` para que cada bloque maneje su propio fallo
 *  sin tumbar la pantalla. `params` se arma con parametrosPantalla() de lib/inventario-pantalla. */

export type Resultado<T> = { dato: T } | { error: string };

async function pedir<T>(ruta: string, clave: string, params: URLSearchParams, mensajeError: string): Promise<Resultado<T>> {
  const qs = params.toString();
  try {
    const r = await apiFetch<Record<string, T>>(`/api/inventario/pantalla/${ruta}${qs ? `?${qs}` : ''}`);
    const dato = r[clave];
    if (!dato) return { error: mensajeError };
    return { dato };
  } catch (err) {
    return { error: err instanceof Error && err.message ? err.message : mensajeError };
  }
}

export const obtenerDetallePantalla = (params: URLSearchParams) =>
  pedir<DetallePantalla>('detalle', 'detalle', params, 'No se pudo cargar el detalle del inventario.');

export const obtenerCategoriasPantalla = (params: URLSearchParams) =>
  pedir<CategoriasPantalla>('categorias', 'categorias', params, 'No se pudieron cargar las categorías del inventario.');

export const obtenerFlujoPantalla = (params: URLSearchParams) =>
  pedir<FlujoPantalla>('flujo', 'flujo', params, 'No se pudo cargar el flujo del material.');

export const obtenerAlertasPantalla = (params: URLSearchParams) =>
  pedir<AlertasPantalla>('alertas', 'alertas', params, 'No se pudieron cargar las alertas del inventario.');
