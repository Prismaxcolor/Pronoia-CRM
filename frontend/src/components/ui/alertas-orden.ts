import type { Severidad } from '../../lib/paleta';

const ORDEN: Record<Severidad, number> = { roja: 0, amarilla: 1, info: 2 };

/** Orden de más a menos grave (estable dentro de cada severidad). No muta la entrada. */
export function ordenarPorSeveridad<T extends { severidad: Severidad }>(alertas: readonly T[]): T[] {
  return alertas.map((a, i) => ({ a, i })).sort((x, y) => ORDEN[x.a.severidad] - ORDEN[y.a.severidad] || x.i - y.i).map(x => x.a);
}
