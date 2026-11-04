/** Porcentaje 0-100 acotado; con meta inválida (<=0) devuelve 0. */
export function porcentajeProgreso(valor: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(valor)) return 0;
  return Math.min(100, Math.max(0, (valor / max) * 100));
}
