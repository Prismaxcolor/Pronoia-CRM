/** Duplicado intencional de shared/types/ticket-pesaje.ts (el backend no
 *  importa shared en runtime); backend/tests/diferencia-peso.test.ts
 *  verifica que ambas copias den siempre el mismo resultado. */

/** Redondea a 3 decimales (gramos): elimina el ruido de punto flotante
 *  (0.2 * 3 = 0.6000000000000001) antes de guardar o comparar pesos. */
export function redondearKg(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;
}

/** Diferencia = peso global - suma neta de materiales - devolución. */
export function calcularDiferenciaPeso(p: { pesoGlobal: number; netoMateriales: number; devolucion: number }): number {
  return redondearKg(redondearKg(p.pesoGlobal) - redondearKg(p.netoMateriales) - redondearKg(p.devolucion));
}
