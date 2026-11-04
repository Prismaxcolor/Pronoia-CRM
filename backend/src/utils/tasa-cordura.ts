/** Variación máxima aceptada entre la tasa nueva y la última guardada de la misma fuente (30 %). */
export const UMBRAL_VARIACION_TASA = 0.3;

/** Si la última tasa es más vieja que esto, ya no sirve de referencia (una devaluación real no debe bloquear para siempre). */
export const MAX_ANTIGUEDAD_REFERENCIA_MS = 7 * 24 * 60 * 60 * 1000;

export interface ReferenciaTasa {
  tasa: number;
  capturadaEn: Date;
}

/** Variación relativa |nueva - anterior| / anterior. Infinity si la anterior no es un número positivo. */
export function variacionRelativa(nueva: number, anterior: number): number {
  if (!Number.isFinite(anterior) || anterior <= 0) return Infinity;
  return Math.abs(nueva - anterior) / anterior;
}

/**
 * ¿La tasa nueva es creíble frente a la última guardada? Sin referencia usable (no hay, no es un
 * número positivo, o es muy vieja) se acepta: no hay contra qué comparar.
 */
export function esTasaCreible(
  nueva: number,
  referencia: ReferenciaTasa | null,
  ahora: Date = new Date(),
  umbral: number = UMBRAL_VARIACION_TASA
): boolean {
  if (!Number.isFinite(nueva) || nueva <= 0) return false;
  if (!referencia || !(referencia.tasa > 0)) return true;
  if (ahora.getTime() - referencia.capturadaEn.getTime() > MAX_ANTIGUEDAD_REFERENCIA_MS) return true;
  return variacionRelativa(nueva, referencia.tasa) <= umbral;
}
