import { detectarFormatoImagen, infoFormatoImagen } from './firma-imagen.js';

/**
 * Fotos de control interno de las paletas del packing list.
 * Viven en un bucket PRIVADO (nunca URL pública): en la BD solo se guarda la ruta y el detalle devuelve URLs firmadas.
 */

export const BUCKET_FOTOS_PACKING = 'packing-fotos';
/** Máximo de fotos por paleta (una paleta rara vez necesita más de unas cuantas tomas). */
export const MAX_FOTOS_POR_PALETA = 5;
/** Igual que el resto de subidas de imágenes del sistema (el teléfono comprime antes de subir). */
export const TAMANO_MAXIMO_FOTO_PACKING = 6 * 1024 * 1024;
/** Vigencia de las URLs firmadas del detalle: alcanza para trabajar la pantalla; al recargar se firman de nuevo. */
export const VIGENCIA_URL_FOTO_S = 60 * 60;

/** Solo rutas generadas por el sistema: `pl/<uuid>.<jpg|png|webp>`. Evita rutas arbitrarias, URLs externas y SVG. */
const RUTA_FOTO = /^pl\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export const esRutaFotoPacking = (valor: string): boolean => RUTA_FOTO.test(valor);

export const rutaNuevaFotoPacking = (uuid: string, extension: string): string => `pl/${uuid}.${extension}`;

export type ArchivoFotoValidado =
  | { ok: true; mime: string; extension: string }
  | { ok: false; error: string };

/** El formato sale de la firma real del contenido (no del nombre ni del tipo que declara el cliente). */
export function validarArchivoFotoPacking(buffer: Uint8Array): ArchivoFotoValidado {
  if (buffer.length > TAMANO_MAXIMO_FOTO_PACKING) {
    return { ok: false, error: 'La foto pesa más de 6 MB. Toma otra o redúcela.' };
  }
  const formato = detectarFormatoImagen(buffer);
  if (!formato) return { ok: false, error: 'El archivo no es una imagen válida (JPG, PNG o WEBP).' };
  const info = infoFormatoImagen(formato);
  return { ok: true, mime: info.mime, extension: info.extension };
}
