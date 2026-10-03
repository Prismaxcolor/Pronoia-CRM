/** Largo máximo de un nombre de archivo / clave de Storage generado por el backend. */
export const MAX_LARGO_NOMBRE_ARCHIVO = 80;

/**
 * Convierte texto libre (nombres de proveedores, códigos) en un fragmento seguro para
 * nombres de archivo y claves de Storage: sin tildes/ñ, solo [a-z0-9._-], guiones
 * colapsados, sin puntos repetidos ni separadores de ruta, y de largo acotado.
 */
export function slugArchivo(texto: string, max = MAX_LARGO_NOMBRE_ARCHIVO): string {
  const limpio = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-')
    .slice(0, max)
    .replace(/^[-.]+|[-.]+$/g, '');
  return limpio || 'archivo';
}

/** Igual que slugArchivo pero conserva la extensión (".pdf", ".jpg") dentro del máximo. */
export function nombreArchivoSeguro(nombre: string, max = MAX_LARGO_NOMBRE_ARCHIVO): string {
  const punto = nombre.lastIndexOf('.');
  const extension = punto > 0 ? slugArchivo(nombre.slice(punto + 1), 10) : '';
  if (!extension || punto <= 0) return slugArchivo(nombre, max);
  return `${slugArchivo(nombre.slice(0, punto), max - extension.length - 1)}.${extension}`;
}
