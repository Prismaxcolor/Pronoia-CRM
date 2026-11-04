/** Largo máximo (sin extensión) del nombre de un documento descargado o compartido. */
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
 * Mantener igual a nombreArchivoDocumento en backend/src/utils/nombre-archivo.ts.
 */
export function nombreArchivoDocumento({ prefijo, codigo, entidad, extension = 'pdf' }: PartesNombreDocumento): string {
  const base = [limpiarFragmento(prefijo), limpiarFragmento(codigo)].filter(Boolean).join('-');
  const restante = MAX_LARGO_NOMBRE_DOCUMENTO - base.length - 1;
  const tercero = limpiarFragmento(entidad).slice(0, Math.max(restante, 0)).replace(/^[-.]+|[-.]+$/g, '');
  const nombre = [base, tercero].filter(Boolean).join('-').slice(0, MAX_LARGO_NOMBRE_DOCUMENTO) || 'Documento';
  const ext = limpiarFragmento(extension) || 'pdf';
  return `${nombre}.${ext}`;
}
