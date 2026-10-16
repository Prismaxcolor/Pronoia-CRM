/**
 * Reparto del pago de UNA moneda entre varias cuentas (p. ej. 30 USD = 20 de CAJA BINANCE PS + 10 de CAJA CHICA PS), sin React.
 * Todo se compara en CENTAVOS enteros. El servidor y la base de datos vuelven a validar la suma exacta; aquí solo se guía a la
 * persona (cuánto falta, cuánto se excede) y se evita enviar un reparto que no cuadra.
 *
 * Una sola cuenta = pago completo (sin monto). Con dos o más, cada fila lleva su monto.
 */
import type { Banca } from '../../../../shared/types/banca.js';
import type { MonedaPago } from '../../../../shared/types/nomina-calculo.js';
import { formatearNumero } from '../../lib/formato';
import type { OpcionComision } from '../cochinito/comision-formulario';

/** Mismo tope que el backend (MAX_CUENTAS_POR_MONEDA) y la función SQL. */
export const MAX_CUENTAS_POR_MONEDA = 5;

/** Una cuenta del pago de una moneda: cuenta, cuánto sale de ella (texto del campo) y, en Bs, si lleva comisión. */
export interface EleccionPago {
  bancaId: string;
  comision: OpcionComision;
  /** Texto del monto; '' mientras haya una sola cuenta (paga todo). */
  monto: string;
}

export const ELECCION_VACIA: EleccionPago = { bancaId: '', comision: '', monto: '' };

export type EstadoReparto = 'completo' | 'falta' | 'excede';

export interface ResumenReparto {
  /** Suma de los montos escritos, en centavos (los vacíos o inválidos cuentan 0). */
  asignado: number;
  /** total - asignado: positivo = falta por asignar, negativo = excede. */
  diferencia: number;
  estado: EstadoReparto;
}

export const centavosDe = (n: number): number => Math.round(n * 100);

/** Texto de un monto en centavos, para el campo de monto ("20.50"). */
export const textoMonto = (centavos: number): string => (centavos / 100).toFixed(2);

/** Texto del campo -> centavos; null si está vacío o no es un monto válido con 2 decimales como máximo. Acepta coma o punto. */
export function centavosDeTexto(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  return centavosDe(Number(limpio));
}

export const esReparto = (filas: readonly EleccionPago[]): boolean => filas.length > 1;

/** Filas de una moneda; sin elección todavía hay una fila vacía. */
export function filasDe(filas: readonly EleccionPago[] | undefined): readonly EleccionPago[] {
  return filas && filas.length > 0 ? filas : [ELECCION_VACIA];
}

/** Monto de una fila en centavos: con una sola cuenta es todo el total; en un reparto, lo escrito (null si falta o es inválido). */
export function montoDeFila(filas: readonly EleccionPago[], indice: number, totalCentavos: number): number | null {
  if (!esReparto(filas)) return totalCentavos;
  return centavosDeTexto(filas[indice]?.monto ?? '');
}

export function resumenReparto(filas: readonly EleccionPago[], totalCentavos: number): ResumenReparto {
  if (!esReparto(filas)) return { asignado: totalCentavos, diferencia: 0, estado: 'completo' };
  const asignado = filas.reduce((s, f) => s + (centavosDeTexto(f.monto) ?? 0), 0);
  const diferencia = totalCentavos - asignado;
  return { asignado, diferencia, estado: diferencia === 0 ? 'completo' : diferencia > 0 ? 'falta' : 'excede' };
}

const montoLegible = (moneda: MonedaPago, centavos: number): string =>
  `${moneda === 'USD' ? 'USD' : 'Bs'} ${formatearNumero(centavos / 100, 2)}`;

/** "Falta por asignar: USD 10,00" / "Excede en USD 5,00" / null si cuadra. */
export function textoDiferencia(moneda: MonedaPago, resumen: ResumenReparto): string | null {
  if (resumen.estado === 'falta') return `Falta por asignar: ${montoLegible(moneda, resumen.diferencia)}`;
  if (resumen.estado === 'excede') return `Excede en ${montoLegible(moneda, -resumen.diferencia)}`;
  return null;
}

/** Añade una cuenta al reparto. Al pasar de una a dos, la primera conserva el total como punto de partida para que lo reduzca. */
export function agregarCuenta(filas: readonly EleccionPago[], totalCentavos: number): EleccionPago[] {
  if (filas.length >= MAX_CUENTAS_POR_MONEDA) return [...filas];
  const base = filas.length === 1 ? [{ ...filas[0], monto: textoMonto(totalCentavos) }] : [...filas];
  return [...base, ELECCION_VACIA];
}

/** Quita una cuenta; si queda una sola vuelve a ser el pago completo (sin monto). */
export function quitarCuenta(filas: readonly EleccionPago[], indice: number): EleccionPago[] {
  const resto = filas.filter((_, i) => i !== indice);
  return resto.length === 1 ? [{ ...resto[0], monto: '' }] : resto;
}

/** Cambia una fila sin mutar la lista. */
export function cambiarFila(filas: readonly EleccionPago[], indice: number, nueva: EleccionPago): EleccionPago[] {
  return filas.map((f, i) => (i === indice ? nueva : f));
}

/** «Asignar el resto»: el monto de la ÚLTIMA cuenta pasa a ser lo que falta para completar el total (no cambia si nada falta). */
export function asignarResto(filas: readonly EleccionPago[], totalCentavos: number): EleccionPago[] {
  if (!esReparto(filas)) return [...filas];
  const ultima = filas.length - 1;
  const otras = filas.reduce((s, f, i) => (i === ultima ? s : s + (centavosDeTexto(f.monto) ?? 0)), 0);
  const resto = totalCentavos - otras;
  if (resto <= 0) return [...filas];
  return cambiarFila(filas, ultima, { ...filas[ultima], monto: textoMonto(resto) });
}

/** Cuentas que se ofrecen en una fila: todas las de la moneda menos las ya elegidas en las OTRAS filas. */
export function cuentasParaFila(cuentas: readonly Banca[], filas: readonly EleccionPago[], indice: number): Banca[] {
  const usadas = new Set(filas.filter((_, i) => i !== indice).map(f => f.bancaId).filter(id => id !== ''));
  return cuentas.filter(c => !usadas.has(c.id));
}

/** ¿Se ofrece «Dividir en otra cuenta»? Hay tope por moneda y debe quedar alguna cuenta sin elegir. */
export function puedeDividir(cuentas: readonly Banca[], filas: readonly EleccionPago[]): boolean {
  const elegidas = new Set(filas.map(f => f.bancaId).filter(id => id !== ''));
  return filas.length < MAX_CUENTAS_POR_MONEDA && cuentas.some(c => !elegidas.has(c.id));
}
