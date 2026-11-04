/**
 * Cédula normalizada: mayúsculas y solo letras y números (se quitan puntos, guiones y espacios).
 * "V-12.345.678", "v 12345678" y "V12345678" son la misma cédula. Misma regla que el índice único de
 * docs/migration_nomina.sql (upper(regexp_replace(cedula, '[^A-Za-z0-9]', '', 'g'))): si cambias una, cambia la otra.
 */
export function normalizarCedula(valor: string): string {
  return valor.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}
