/** Máximo de movimientos por página impresa del estado de cuenta. */
export const MOVIMIENTOS_POR_PAGINA_IMPRESION = 15;

/**
 * Parte las filas en trozos de `tamano` (por defecto 15) conservando el orden, sin mutar la entrada.
 * Siempre devuelve al menos un trozo (vacío si no hay filas) para que la página imprima encabezado y totales.
 */
export function paginarImpresion<T>(filas: readonly T[], tamano: number = MOVIMIENTOS_POR_PAGINA_IMPRESION): T[][] {
  const paso = Math.max(1, Math.floor(tamano));
  if (filas.length === 0) return [[]];
  const paginas: T[][] = [];
  for (let i = 0; i < filas.length; i += paso) paginas.push(filas.slice(i, i + paso));
  return paginas;
}
