import type { OpcionLotePacking } from '@shared/types/index.js';
import { getToken } from './api-client';
import { leerGet } from './lectura-service';
import { comprimirImagen } from '../lib/image-compress';
import { rastrearTrabajo } from '../lib/trabajo-en-vuelo';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export const MENSAJE_FOTO_SIN_CONEXION =
  'Sin conexión: la foto no se puede subir ahora. Agrégala cuando vuelva la conexión (el resto del packing list sí se puede guardar).';

/** Lotes de exportación con kg disponibles por almacén (control interno, solo lectura). */
export async function obtenerOpcionesLotePacking(): Promise<OpcionLotePacking[] | { error: string }> {
  try {
    const { lotes } = await leerGet<{ lotes: OpcionLotePacking[] }>('/api/packing-lists/lotes-exportacion');
    return lotes;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudieron cargar los lotes de exportación.' };
  }
}

/**
 * Sube una foto de control interno de una paleta al bucket privado y devuelve su ruta.
 * La foto se sube al momento de agregarla (comprimida): el guardado del packing list solo lleva rutas, así la
 * cola sin conexión no carga imágenes. Sin conexión devuelve un error claro; nunca falla en silencio.
 */
export async function subirFotoPaleta(archivo: File): Promise<{ ruta: string } | { error: string }> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { error: MENSAJE_FOTO_SIN_CONEXION };
  try {
    const comprimida = await comprimirImagen(archivo);
    const formData = new FormData();
    formData.append('file', comprimida);
    const token = getToken();
    const resp = await rastrearTrabajo('subida', () => fetch(`${API_URL}/api/packing-lists/fotos`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: formData,
    }));
    const cuerpo = (await resp.json().catch(() => ({}))) as { ruta?: string; error?: string };
    if (!resp.ok || !cuerpo.ruta) return { error: cuerpo.error ?? 'No se pudo subir la foto. Intenta de nuevo.' };
    return { ruta: cuerpo.ruta };
  } catch {
    return { error: MENSAJE_FOTO_SIN_CONEXION };
  }
}
