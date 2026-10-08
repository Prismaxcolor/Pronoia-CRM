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

/** Largo máximo (sin extensión) del nombre de un documento enviado con el nombre del tercero. */
export const MAX_LARGO_NOMBRE_DOCUMENTO = 80;

/** Texto libre -> fragmento seguro: sin tildes ni caracteres inválidos en Windows/iOS, espacios a guiones. */
function limpiarFragmento(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._\s-]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

export interface PartesNombreDocumento {
  /** Tipo de documento: 'Factura', 'Ticket', 'Pago'... */
  prefijo: string;
  /** Código o referencia del documento (F-000123). */
  codigo?: string | null;
  /** Nombre comercial del cliente o proveedor. */
  entidad?: string | null;
  /** Sin punto. Por defecto 'pdf'. */
  extension?: string;
}

/**
 * Nombre de archivo de un documento con el tercero: 'Factura-F-000123-NOMBRE-CLIENTE.pdf'.
 * Sin nombre del tercero queda solo prefijo + código. Si excede el máximo se recorta el
 * nombre del tercero (el código siempre se conserva).
 * Mantener igual a frontend/src/lib/nombre-archivo.ts.
 */
export function nombreArchivoDocumento({ prefijo, codigo, entidad, extension = 'pdf' }: PartesNombreDocumento): string {
  const base = [limpiarFragmento(prefijo), limpiarFragmento(codigo)].filter(Boolean).join('-');
  const restante = MAX_LARGO_NOMBRE_DOCUMENTO - base.length - 1;
  const tercero = limpiarFragmento(entidad).slice(0, Math.max(restante, 0)).replace(/^[-.]+|[-.]+$/g, '');
  const nombre = [base, tercero].filter(Boolean).join('-').slice(0, MAX_LARGO_NOMBRE_DOCUMENTO) || 'Documento';
  const ext = limpiarFragmento(extension) || 'pdf';
  return `${nombre}.${ext}`;
}
