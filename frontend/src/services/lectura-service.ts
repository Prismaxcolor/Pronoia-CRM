import { apiFetch } from './api-client';
import { leerCatalogo } from '../lib/offline/lectura';
import type { OpcionesLectura } from '../lib/offline/lectura-logica';

/** GET de solo lectura a través de la caché de catálogos: con red es idéntico a `apiFetch(path)`;
 *  sin red sirve lo último guardado (marcado con su antigüedad). La clave es la propia ruta con su query. */
export function leerGet<T>(path: string, opciones?: OpcionesLectura<T>): Promise<T> {
  return leerCatalogo<T>(path, () => apiFetch<T>(path), opciones);
}
