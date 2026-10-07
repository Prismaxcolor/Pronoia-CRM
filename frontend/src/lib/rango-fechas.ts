/** Atajos de rango de fechas (7 días, 30 días, este mes, todo) para filtros de periodo. Lógica pura: el "hoy" se pasa de
 *  afuera para poder probarla. Se re-exporta desde lib/inventario-nuevo.ts. */

import { hoyNegocio } from './fecha-negocio';

export type AtajoRango = '7d' | '30d' | 'mes' | 'todo';
export const INICIO_HISTORICO = '2020-01-01';
export const ATAJOS_RANGO: readonly AtajoRango[] = ['7d', '30d', 'mes', 'todo'];

const aIso = (d: Date) => d.toISOString().slice(0, 10);

/** "Hoy" en la zona de negocio (Caracas), expresado como fecha UTC a medianoche (rangoDeAtajo trabaja en UTC). */
export function hoyLocal(ahora: Date = new Date()): Date {
  return new Date(`${hoyNegocio(ahora)}T00:00:00Z`);
}

/** Rango de un atajo. `hoy` se pasa de afuera (UTC, sin tocar el reloj aquí) para poder probarlo. */
export function rangoDeAtajo(atajo: AtajoRango, hoy: Date): { desde: string; hasta: string } {
  const hasta = aIso(hoy);
  if (atajo === 'todo') return { desde: INICIO_HISTORICO, hasta };
  if (atajo === 'mes') return { desde: `${hasta.slice(0, 7)}-01`, hasta };
  const dias = atajo === '7d' ? 6 : 29;
  const ini = new Date(hoy.getTime() - dias * 86400000);
  return { desde: aIso(ini), hasta };
}

/** Atajo que corresponde al rango actual. Sin rango equivale al valor por defecto de la pantalla (30 días). */
export function atajoActivo(f: { desde?: string; hasta?: string }, hoy: Date): AtajoRango | null {
  if (!f.desde || !f.hasta) return '30d';
  for (const a of ATAJOS_RANGO) {
    const r = rangoDeAtajo(a, hoy);
    if (r.desde === f.desde && r.hasta === f.hasta) return a;
  }
  return null;
}
