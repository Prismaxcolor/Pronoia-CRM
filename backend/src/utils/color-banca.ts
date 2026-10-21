/**
 * Color de una banca (public.bancas.color). Se guarda la clave de la paleta fija
 * o un hex #RRGGBB en mayúsculas. Espejo de las claves de frontend/src/lib/color-banca.ts
 * (se duplica a propósito: ver nota en utils/permisos.ts; un test verifica que coincidan).
 */
export const CLAVES_COLOR_BANCA = [
  'rojo', 'naranja', 'ambar', 'lima', 'verde', 'turquesa',
  'celeste', 'azul', 'indigo', 'violeta', 'rosa', 'gris',
] as const;

const PATRON_HEX = /^#[0-9A-F]{6}$/;

/** Normaliza un color de entrada: recorta, pasa los hex a mayúsculas y las claves a minúsculas. */
export function normalizarColorBanca(valor: string): string {
  const v = valor.trim();
  return v.startsWith('#') ? v.toUpperCase() : v.toLowerCase();
}

/** True si es una clave de la paleta o un hex #RRGGBB en mayúsculas. */
export function esColorBancaValido(valor: string): boolean {
  return PATRON_HEX.test(valor) || (CLAVES_COLOR_BANCA as readonly string[]).includes(valor);
}
