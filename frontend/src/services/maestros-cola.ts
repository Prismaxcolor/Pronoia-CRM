/** Altas de maestros (proveedor, cliente, producto, tara, almacén, vehículo) en el modo sin conexión.
 *  Sin red la alta se guarda en el teléfono con un id temporal y ya se puede usar en un pesaje:
 *  la cola envía primero el alta y luego lo que la usa (cambiando el id temporal por el real). */
import type { FotoLocal } from '../lib/foto-picker';
import { fotosLocalDeUrls } from '../lib/foto-picker';
import { estaOnline } from '../lib/offline/conexion';
import { offlineHabilitado } from '../lib/offline/sesion';
import { ENTIDAD_DE_MAESTRO, peticionAltaMaestro, type TipoMaestro } from '../lib/offline/f4/peticiones-f4';
import { ejecutarF4, entradaTemporal, idTemporalNuevo, provisionalesDe } from '../lib/offline/f4/servicio-f4';

/** true si el formulario debe guardar las fotos en el teléfono en vez de subirlas ahora. */
export function altaEnColaActiva(): boolean {
  return offlineHabilitado() && !estaOnline();
}

export type ResultadoAltaMaestro<T> = { entidad: T; enCola: boolean } | { error: string };

/** `datos` sin `fotos`; las fotos van aparte: nuevas (File) o ya subidas (URL). */
export async function altaMaestroF4<T>(tipo: TipoMaestro, datos: Record<string, unknown>, fotos: FotoLocal[]): Promise<ResultadoAltaMaestro<T>> {
  const idTemporal = idTemporalNuevo();
  const r = await ejecutarF4<Record<string, T>>(peticionAltaMaestro(tipo, datos, fotos, idTemporal, new Date().toISOString()));
  if (r.tipo === 'error') return { error: r.error };
  if (r.tipo === 'enviada') return { entidad: r.respuesta[tipo], enCola: false };
  const provisional = entradaTemporal(idTemporal)?.datos as T | undefined;
  if (!provisional) return { error: 'Quedó guardado en el teléfono, pero no se pudo mostrar. Revisa los pendientes de envío.' };
  return { entidad: provisional, enCola: true };
}

/** URLs ya subidas -> fotos «existentes» (para el camino único de alta cuando el formulario ya las subió). */
export function fotosYaSubidas(urls: readonly string[] | undefined): FotoLocal[] {
  return fotosLocalDeUrls([...(urls ?? [])]);
}

/** Provisionales vigentes de un maestro (para mezclarlos en listas y selectores). */
export function provisionalesDeMaestro<T>(tipo: TipoMaestro): Promise<T[]> {
  return offlineHabilitado() ? provisionalesDe<T>(ENTIDAD_DE_MAESTRO[tipo]) : Promise.resolve([]);
}
