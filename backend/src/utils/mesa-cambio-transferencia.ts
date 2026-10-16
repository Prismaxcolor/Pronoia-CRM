/**
 * Cálculo puro de una transferencia con mesa de cambio (sin base de datos).
 * Espejo de shared/types/mesa-cambio-transferencia.ts (se duplica porque @shared no resuelve en runtime
 * con tsx + ESM) y de la validación que repite la RPC SQL, que es la autoridad.
 *
 * Reglas: la comisión REDUCE lo acreditado al destino (neto = bruto - comisión). El importe del asiento
 * del cambista (USD) es el bruto. Todo devuelve valores nuevos; nunca se muta la entrada.
 */

export type ModoComision = 'porcentaje' | 'monto';

export interface ComisionInput {
  modo: ModoComision;
  /** Porcentaje (0 a menos de 100) o monto en la moneda del destino. */
  valor: number;
}

export type ResultadoComision =
  | { ok: true; comision: number; modo: ModoComision | null; porcentaje: number | null }
  | { ok: false; error: string };

const MONEDA_USD = 'USD';

const redondear2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Comisión del cambio sobre el monto bruto de destino. Sin comisión => 0. */
export function calcularComision(brutoDestino: number, comision: ComisionInput | null | undefined): ResultadoComision {
  if (!comision) return { ok: true, comision: 0, modo: null, porcentaje: null };
  const { modo, valor } = comision;
  if (!Number.isFinite(valor) || valor < 0) return { ok: false, error: 'La comisión no puede ser negativa.' };
  if (modo === 'porcentaje') {
    if (valor >= 100) return { ok: false, error: 'El porcentaje de comisión debe ser menor a 100.' };
    return { ok: true, comision: redondear2((brutoDestino * valor) / 100), modo, porcentaje: valor };
  }
  const monto = redondear2(valor);
  if (monto >= brutoDestino) return { ok: false, error: 'La comisión debe ser menor al monto que entrega el cambista.' };
  return { ok: true, comision: monto, modo, porcentaje: null };
}

/** Lo que se acredita al destino: bruto menos comisión, a centavos. */
export function montoNetoDestino(bruto: number, comision: number): number {
  return redondear2(bruto - comision);
}

export interface EntradaMontoUsd {
  monedaOrigen: string;
  monedaDestino: string;
  monto: number;
  montoDestino: number | null;
  /** Equivalente en USD informado a mano (obligatorio si ni origen ni destino son USD). */
  montoUsdManual?: number | null;
}

export type ResultadoMontoUsd = { ok: true; montoUsd: number } | { ok: false; error: string };

/**
 * Importe en USD del asiento: el lado que ya está en USD; si ninguna cuenta es USD, el equivalente informado a mano.
 * Con una cuenta en USD el monto manual se RECHAZA (no se ignora en silencio): el importe sale de esa cuenta.
 */
export function resolverMontoUsd(e: EntradaMontoUsd): ResultadoMontoUsd {
  const hayCuentaUsd = e.monedaOrigen === MONEDA_USD || e.monedaDestino === MONEDA_USD;
  if (hayCuentaUsd && e.montoUsdManual != null) {
    return { ok: false, error: 'No indiques el equivalente en USD: una de las cuentas ya está en USD y se usa su importe.' };
  }
  if (e.monedaOrigen === MONEDA_USD) return { ok: true, montoUsd: redondear2(e.monto) };
  if (e.monedaDestino === MONEDA_USD) return { ok: true, montoUsd: redondear2(e.montoDestino ?? e.monto) };
  if (e.montoUsdManual == null) {
    return { ok: false, error: 'Indica el equivalente en USD de la operación: ninguna de las dos cuentas está en USD.' };
  }
  if (!(e.montoUsdManual > 0)) return { ok: false, error: 'El equivalente en USD debe ser mayor a 0.' };
  return { ok: true, montoUsd: redondear2(e.montoUsdManual) };
}

export interface EntradaPlan extends EntradaMontoUsd {
  saldoOrigen: number;
  comision?: ComisionInput | null;
}

export type PlanTransferenciaMesa =
  | {
      ok: true;
      montoUsd: number;
      montoBruto: number;
      comision: number;
      montoNeto: number;
      modo: ModoComision | null;
      porcentaje: number | null;
    }
  | { ok: false; error: string };

/** Valida y calcula todo lo que la transferencia necesita antes de llamar a la RPC. */
export function planificarTransferenciaMesa(entrada: EntradaPlan): PlanTransferenciaMesa {
  // Igual que la RPC: los importes se redondean a centavos ANTES de validar y de calcular.
  const monto = redondear2(entrada.monto);
  const montoDestino = entrada.montoDestino == null ? null : redondear2(entrada.montoDestino);
  const e: EntradaPlan = { ...entrada, monto, montoDestino };
  if (!(monto > 0)) return { ok: false, error: 'El monto debe ser mayor a 0.' };
  if (monto > e.saldoOrigen) return { ok: false, error: 'Saldo insuficiente en la cuenta de origen.' };
  const mismaMoneda = e.monedaOrigen === e.monedaDestino;
  if (!mismaMoneda && !(montoDestino != null && montoDestino > 0)) {
    return { ok: false, error: 'Indica el monto que llega a la cuenta destino (monedas distintas).' };
  }
  const montoBruto = mismaMoneda ? monto : (montoDestino as number);
  const comision = calcularComision(montoBruto, e.comision);
  if (!comision.ok) return comision;
  const usd = resolverMontoUsd({ ...e, montoDestino: mismaMoneda ? null : e.montoDestino });
  if (!usd.ok) return usd;
  return {
    ok: true,
    montoUsd: usd.montoUsd,
    montoBruto,
    comision: comision.comision,
    montoNeto: montoNetoDestino(montoBruto, comision.comision),
    modo: comision.modo,
    porcentaje: comision.porcentaje,
  };
}
