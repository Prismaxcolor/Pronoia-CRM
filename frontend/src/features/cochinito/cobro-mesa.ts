import type { Movimiento } from '@shared/types/index.js';
import { leerNumero } from './transferencia-mesa';

/**
 * Cobro (total o parcial) de una transferencia con mesa de cambio, lado cliente. Solo cálculo y validación de
 * lo que ve el usuario; la autoridad es la RPC cobrar_transferencia_mesa_cambio en el servidor.
 */

type CamposCobro = Pick<Movimiento, 'mesaCambistaId' | 'mesaEstado' | 'mesaMontoBruto' | 'mesaComision' | 'mesaMontoCobrado' | 'montoDestino' | 'monto'>;

const redondear2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

function netoMesa(m: CamposCobro): number | null {
  return m.mesaMontoBruto == null ? null : redondear2(m.mesaMontoBruto - (m.mesaComision ?? 0));
}

/** Neto ya acreditado al destino (moneda destino); null si no es una transferencia con mesa. */
export function montoCobradoMesa(m: CamposCobro): number | null {
  if (m.mesaCambistaId == null) return null;
  if (m.mesaEstado === 'completada') return m.mesaMontoCobrado ?? m.montoDestino ?? m.monto;
  return m.mesaMontoCobrado ?? 0;
}

/** Lo que falta por cobrar al cambista (neto - cobrado); 0 si ya se completó; null si no aplica. */
export function montoPendienteMesa(m: CamposCobro): number | null {
  if (m.mesaCambistaId == null) return null;
  if (m.mesaEstado === 'completada') return 0;
  const neto = netoMesa(m);
  const cobrado = montoCobradoMesa(m);
  return neto == null || cobrado == null ? null : redondear2(neto - cobrado);
}

export type ResultadoCobro =
  | { ok: true; montoCobrado: number | null; quedaPendiente: number }
  | { ok: false; error: string };

/** Valida el monto escrito. Cobro total => montoCobrado null (el servidor cobra todo lo pendiente). */
export function validarCobroMesa(e: { parcial: boolean; texto: string; pendiente: number }): ResultadoCobro {
  if (!e.parcial) return { ok: true, montoCobrado: null, quedaPendiente: 0 };
  const n = leerNumero(e.texto);
  if (n === null || !(n > 0)) return { ok: false, error: 'Indica cuánto cobraste (mayor a 0).' };
  if (redondear2(n) !== n) return { ok: false, error: 'El monto admite hasta 2 decimales.' };
  if (n > e.pendiente) return { ok: false, error: `No puede superar lo pendiente (${e.pendiente.toFixed(2)}).` };
  return { ok: true, montoCobrado: n, quedaPendiente: redondear2(e.pendiente - n) };
}
