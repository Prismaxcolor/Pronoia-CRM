/**
 * Reparto de la parte a pagar de UNA moneda entre varias cuentas (p. ej. 30 USD = 20 de CAJA BINANCE PS + 10 de CAJA CHICA PS).
 * Lógica pura en CENTAVOS enteros (nada de flotantes al comparar sumas). La función SQL nomina_reparto_normalizar repite
 * estas mismas reglas y es la autoridad; aquí se valida antes para responder 400 con un mensaje claro sin tocar la BD.
 *
 * Contrato: un pago sin `monto` y único en su moneda = pago completo (como antes). Con varias cuentas en la misma moneda
 * TODAS llevan `monto` y la suma debe ser exactamente la parte a pagar de esa moneda.
 */

/** Máximo de cuentas por moneda en un reparto (la función SQL usa el mismo tope). */
export const MAX_CUENTAS_POR_MONEDA = 5;

export interface EntradaReparto {
  bancaId: string;
  /** Monto en la moneda del pago, con 2 decimales; opcional si es la única cuenta de la moneda. */
  monto?: number;
}

export interface CuentaRepartida {
  bancaId: string;
  /** Monto asignado a la cuenta, en centavos de la moneda del pago. */
  centavos: number;
}

export interface FalloReparto {
  error: string;
  codigo: number;
}

export const aCentavos = (n: number): number => Math.round(n * 100);

/** true si `n` tiene como máximo 2 decimales. */
export const tieneDosDecimales = (n: number): boolean => Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

/** Centavos como texto con 2 decimales ("20.50"); solo para mensajes. */
export const textoCentavos = (c: number): string => (c / 100).toFixed(2);

function problemaDeEntrada(e: EntradaReparto, repartido: boolean): string | null {
  if (e.monto === undefined) return repartido ? 'Indica el monto de cada cuenta del reparto.' : null;
  if (!tieneDosDecimales(e.monto)) return 'El monto de cada cuenta debe tener como máximo 2 decimales.';
  if (aCentavos(e.monto) <= 0) return 'Cada cuenta del reparto debe llevar un monto mayor a cero.';
  return null;
}

function diferenciaTexto(totalCentavos: number, sumaCentavos: number): string {
  const dif = totalCentavos - sumaCentavos;
  return dif > 0 ? `faltan ${textoCentavos(dif)} por asignar` : `se excede en ${textoCentavos(-dif)}`;
}

/**
 * Valida y normaliza el reparto de una moneda. `totalCentavos` es la parte a pagar de la moneda (la calcula el servidor).
 * Devuelve las cuentas con su monto en centavos (el pago único sin monto recibe el total).
 */
export function normalizarReparto(
  entradas: readonly EntradaReparto[], totalCentavos: number,
): { cuentas: CuentaRepartida[] } | FalloReparto {
  if (entradas.length === 0) return { error: 'Elige la cuenta desde la que se paga.', codigo: 400 };
  if (entradas.length > MAX_CUENTAS_POR_MONEDA) {
    return { error: `Máximo ${MAX_CUENTAS_POR_MONEDA} cuentas por moneda.`, codigo: 400 };
  }
  if (new Set(entradas.map(e => e.bancaId)).size !== entradas.length) {
    return { error: 'La misma cuenta no puede repetirse dentro del reparto.', codigo: 400 };
  }
  const repartido = entradas.length > 1;
  for (const e of entradas) {
    const problema = problemaDeEntrada(e, repartido);
    if (problema) return { error: problema, codigo: 400 };
  }
  const cuentas = entradas.map(e => ({ bancaId: e.bancaId, centavos: e.monto === undefined ? totalCentavos : aCentavos(e.monto) }));
  const suma = cuentas.reduce((s, c) => s + c.centavos, 0);
  if (suma !== totalCentavos) {
    return { error: `El reparto debe sumar exactamente ${textoCentavos(totalCentavos)}: ${diferenciaTexto(totalCentavos, suma)}.`, codigo: 400 };
  }
  return { cuentas };
}
