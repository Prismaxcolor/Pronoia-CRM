import type { Tara, TaraDetalle } from '@shared/types/index.js';
import { redondearKg } from '../../../../shared/types/ticket-pesaje.js';

/** Una tara individual de una fila: preconfigurada (tara × cantidad) o un kg manual. */
export interface TaraUnidad {
  taraModo: 'preconfigurada' | 'manual';
  taraId: string;
  taraCantidad: string;
  taraManual: string;
}

/** Fila que puede llevar taras adicionales a la principal (p. ej. saca + cesta). */
export interface ConTarasExtra {
  tarasExtra?: TaraUnidad[];
}

export function taraUnidadVacia(): TaraUnidad {
  return { taraModo: 'preconfigurada', taraId: '', taraCantidad: '', taraManual: '' };
}

/** Kg de una sola tara, según su modo. */
export function taraUnidadKg(t: TaraUnidad, taras: Tara[]): number {
  if (t.taraModo === 'manual') return redondearKg(Number(t.taraManual) || 0);
  const tara = taras.find(x => x.id === t.taraId);
  if (!tara) return 0;
  return redondearKg(tara.peso * (Number(t.taraCantidad) || 0));
}

/** Tara total de la fila: la principal más todas las adicionales. Sin
 *  `tarasExtra` (datos y borradores anteriores) es solo la principal. */
export function taraTotalKg(f: TaraUnidad & ConTarasExtra, taras: Tara[]): number {
  const extras = (f.tarasExtra ?? []).reduce((suma, e) => suma + taraUnidadKg(e, taras), 0);
  return redondearKg(taraUnidadKg(f, taras) + extras);
}

/** true si la tara tiene unidades tecleadas pero no se eligió cuál tara es. */
export function taraUnidadIncompleta(t: TaraUnidad): boolean {
  return t.taraModo === 'preconfigurada' && Number(t.taraCantidad) > 0 && !t.taraId;
}

/** true si la tara principal o alguna adicional quedó incompleta. */
export function filaTaraIncompleta(f: TaraUnidad & ConTarasExtra): boolean {
  return taraUnidadIncompleta(f) || (f.tarasExtra ?? []).some(taraUnidadIncompleta);
}

/** Tolerancia (kg) entre la suma de un desglose guardado y la tara total del material. */
const TOLERANCIA_DESGLOSE_KG = 0.005;

/** Desglose de la tara de una fila para guardarlo con el ticket: una entrada por
 *  tara con kg > 0 (la principal y las adicionales). Vacío si la fila no tiene tara. */
export function tarasDetalleDeFila(f: TaraUnidad & ConTarasExtra, taras: Tara[]): TaraDetalle[] {
  const detalle: TaraDetalle[] = [];
  for (const u of [f, ...(f.tarasExtra ?? [])]) {
    const kg = taraUnidadKg(u, taras);
    if (kg <= 0) continue;
    if (u.taraModo === 'manual') {
      detalle.push({ tipo: 'manual', nombre: 'Manual', kg });
      continue;
    }
    const tara = taras.find(x => x.id === u.taraId);
    detalle.push({ tipo: 'tabla', taraId: u.taraId, nombre: tara?.nombre ?? 'Tara', cantidad: Number(u.taraCantidad) || 0, kg });
  }
  return detalle;
}

/** Restaura las taras individuales del editor a partir del desglose guardado. Sin
 *  desglose (o si ya no cuadra con la tara total) queda una sola tara manual con el
 *  total, como antes. Una tara de la tabla se restaura como preconfigurada solo si
 *  sigue vigente y su peso actual da los mismos kg; si no, como manual con esos kg
 *  (así reabrir un ticket nunca cambia la tara guardada). */
export function filaTaraDesdeDetalle(
  detalle: TaraDetalle[] | null | undefined,
  taraTotal: number,
  taras: Tara[]
): TaraUnidad & ConTarasExtra {
  const suma = redondearKg((detalle ?? []).reduce((acc, t) => acc + t.kg, 0));
  if (!detalle || detalle.length === 0 || Math.abs(suma - taraTotal) > TOLERANCIA_DESGLOSE_KG) {
    return { ...taraUnidadVacia(), taraModo: 'manual', taraManual: String(taraTotal) };
  }
  const unidades = detalle.map((t): TaraUnidad => {
    const tara = t.tipo === 'tabla' ? taras.find(x => x.id === t.taraId) : undefined;
    const cantidad = t.cantidad ?? 1;
    if (tara && redondearKg(tara.peso * cantidad) === redondearKg(t.kg)) {
      return { taraModo: 'preconfigurada', taraId: tara.id, taraCantidad: String(cantidad), taraManual: '' };
    }
    return { taraModo: 'manual', taraId: '', taraCantidad: '', taraManual: String(t.kg) };
  });
  const [principal, ...extras] = unidades;
  return extras.length > 0 ? { ...principal, tarasExtra: extras } : principal;
}
