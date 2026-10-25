/**
 * Texto de las descripciones de pagos y cobros.
 *
 * Hasta ahora el formulario "Registrar pago/cobro" proponía descripciones del tipo "Pago combinado: C-0001, ...".
 * Esa etiqueta ya no se muestra: en el estado de cuenta y en el comprobante se lee "Pago: C-0001, ..." (o "Cobro: ...").
 * Se limpia al mostrar para que también quede bien lo ya guardado; los datos de la base no se tocan.
 */

const ETIQUETA_COMBINADO = /\b(Pago|Cobro) combinado\b/gi;

/** Quita la palabra "combinado" de "Pago combinado" / "Cobro combinado", conservando el resto del texto. */
export function sinTextoCombinado<T extends string | null | undefined>(descripcion: T): T {
  if (!descripcion) return descripcion;
  return descripcion.replace(ETIQUETA_COMBINADO, '$1') as T;
}
