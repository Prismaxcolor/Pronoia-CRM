/** Reglas de la imagen de una cuenta/caja en el cliente (el servidor las vuelve a validar por la firma real del archivo). */

export const TIPOS_IMAGEN_BANCA: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

/** Igual que el límite de POST /api/uploads (6 MB); se comprime antes de subir, así que rara vez se alcanza. */
export const MAX_BYTES_IMAGEN_BANCA = 6 * 1024 * 1024;

/** Mensaje de error si el archivo no sirve como imagen de cuenta (SVG y otros formatos no se aceptan); null si sirve. */
export function errorImagenBanca(file: { type: string; size: number }): string | null {
  if (!TIPOS_IMAGEN_BANCA.includes(file.type)) return 'La imagen debe ser JPG, PNG o WEBP.';
  if (file.size > MAX_BYTES_IMAGEN_BANCA) return 'La imagen pesa más de 6 MB.';
  return null;
}

/**
 * Qué mandar al servidor al guardar: `undefined` = no tocar (sin cambios), `null` = quitar, texto = URL nueva.
 * `actual` es la imagen guardada; `elegida` es la URL final tras subir (null si el usuario la quitó).
 */
export function imagenParaGuardar(actual: string | null | undefined, elegida: string | null): string | null | undefined {
  return (actual ?? null) === elegida ? undefined : elegida;
}
