/** Formatos y tamaño que acepta el backend para el comprobante (POST /api/uploads/comprobantes). */
export const TIPOS_COMPROBANTE = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Antes de comprimir: una foto de cámara pesa varios MB y el compresor la achica; el servidor
 *  igual rechaza lo que pase de 5 MB al llegar. */
export const MAX_BYTES_COMPROBANTE_ORIGINAL = 15 * 1024 * 1024;
export const MAX_COMPROBANTES = 10;

/** Mensaje de error si el archivo no sirve como comprobante; null si es válido. */
export function validarImagenComprobante(file: Pick<File, 'type' | 'size' | 'name'>): string | null {
  if (!(TIPOS_COMPROBANTE as readonly string[]).includes(file.type)) {
    return `"${file.name}": formato no permitido. Usa JPG, PNG o WEBP.`;
  }
  if (file.size > MAX_BYTES_COMPROBANTE_ORIGINAL) {
    return `"${file.name}": la imagen es demasiado pesada (máximo 15 MB).`;
  }
  return null;
}

/** Separa los archivos válidos de los errores, respetando el tope de comprobantes. */
export function filtrarComprobantes<T extends Pick<File, 'type' | 'size' | 'name'>>(
  nuevos: T[], yaElegidos: number
): { validos: T[]; errores: string[] } {
  const validos: T[] = [];
  const errores: string[] = [];
  for (const f of nuevos) {
    const error = validarImagenComprobante(f);
    if (error) errores.push(error);
    else if (yaElegidos + validos.length >= MAX_COMPROBANTES) errores.push(`Máximo ${MAX_COMPROBANTES} comprobantes.`);
    else validos.push(f);
  }
  return { validos, errores };
}
