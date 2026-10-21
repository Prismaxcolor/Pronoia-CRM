/**
 * Pagar una nómina cerrada desde el Wallet (fase 2): reglas puras para validar las cuentas elegidas antes de llamar a la
 * función SQL nomina_pagar, que es la autoridad (vuelve a validar cuentas, monedas, saldo y comisión).
 */
import { aplicaComisionBancaria } from './comision-bancaria.js';
import type { MonedaPago } from './nomina-calculo.js';
import { aCentavos, normalizarReparto, type EntradaReparto } from './nomina-reparto.js';

export const MENSAJE_COMISION_PENDIENTE =
  'La comisión bancaria aún no está habilitada en la base de datos (falta aplicar migration_wallet_comision_bancaria.sql).';

export const MENSAJE_PAGO_NO_HABILITADO =
  'El pago de nómina desde el Wallet aún no está habilitado en la base de datos (falta aplicar migration_nomina_pago_wallet.sql).';

export const MENSAJE_PAGO_INDIVIDUAL_NO_HABILITADO =
  'El pago por trabajador aún no está habilitado en la base de datos (falta aplicar migration_nomina_pago_por_trabajador.sql).';

export const MENSAJE_PAGO_PRESTAMO_NO_HABILITADO =
  'El pago del préstamo desde el Wallet aún no está habilitado en la base de datos (falta aplicar migration_nomina_prestamo_desembolso.sql).';

/** Moneda de la cuenta del Wallet que corresponde a cada moneda de pago de la nómina. */
export const MONEDA_CUENTA: Record<MonedaPago, string> = { USD: 'USD', BS: 'VES' };

const ETIQUETA_MONEDA: Record<MonedaPago, string> = { USD: 'divisas (USD)', BS: 'bolívares (Bs)' };

export interface CuentaWallet {
  id: string;
  nombre: string;
  moneda: string;
  archivada: boolean;
}

export interface PagoSolicitado {
  moneda: MonedaPago;
  bancaId: string;
  llevaComision?: boolean;
  /** Monto de esta cuenta en la moneda del pago (reparto entre varias cuentas); sin él, la cuenta paga todo. */
  monto?: number;
}

/** Lo que se paga en cada moneda, en centavos; 0 = nada que pagar en esa moneda. */
export type MontosPorMoneda = Readonly<Record<MonedaPago, number>>;

/** Lo que recibe la función SQL por cada moneda: `llevaComision` es null cuando no aplica o no se ofrece. */
export interface PagoPlanificado {
  moneda: MonedaPago;
  bancaId: string;
  llevaComision: boolean | null;
  /** Monto de la cuenta en su moneda, ya validado; solo cuando el pago trae reparto (con una cuenta lo calcula la BD). */
  monto?: number;
}

export interface FalloPlan {
  error: string;
  codigo: number;
}

/** Lo que se paga en cada moneda, en centavos. Un trabajador con las dos partes aporta a las dos monedas. */
export function montosPorPagar(lineas: ReadonlyArray<{ pagarUsd: number; pagarBs: number | null }>): MontosPorMoneda {
  return {
    USD: lineas.reduce((s, l) => s + aCentavos(l.pagarUsd), 0),
    BS: lineas.reduce((s, l) => s + aCentavos(l.pagarBs ?? 0), 0),
  };
}

/** Monedas con algo que pagar: divisas si la suma de lo que se paga en USD es mayor a cero, bolívares si la de Bs lo es. */
export function monedasPorPagar(lineas: ReadonlyArray<{ pagarUsd: number; pagarBs: number | null }>): MonedaPago[] {
  const montos = montosPorPagar(lineas);
  return [...(montos.USD > 0 ? ['USD' as const] : []), ...(montos.BS > 0 ? ['BS' as const] : [])];
}

function validarCuenta(pago: PagoSolicitado, cuenta: CuentaWallet | undefined): FalloPlan | null {
  if (!cuenta) return { error: 'La cuenta elegida no existe.', codigo: 400 };
  if (cuenta.archivada) return { error: `La cuenta ${cuenta.nombre} está archivada.`, codigo: 400 };
  if (cuenta.moneda !== MONEDA_CUENTA[pago.moneda]) {
    return { error: `La cuenta ${cuenta.nombre} es en ${cuenta.moneda} y este pago es en ${ETIQUETA_MONEDA[pago.moneda]}.`, codigo: 400 };
  }
  return null;
}

/** Decide la comisión de una cuenta: obligatoria elegir en Bs si la migración está aplicada; nunca en USD. */
export function comisionDe(
  pago: Pick<PagoSolicitado, 'llevaComision'>, cuenta: CuentaWallet, comisionDisponible: boolean,
): { llevaComision: boolean | null } | FalloPlan {
  if (!aplicaComisionBancaria('egreso', cuenta.moneda)) {
    return pago.llevaComision === true
      ? { error: 'La comisión bancaria solo aplica cuando la cuenta de origen está en bolívares (Bs).', codigo: 400 }
      : { llevaComision: null };
  }
  if (pago.llevaComision === undefined) {
    return comisionDisponible
      ? { error: 'Indica si el pago en bolívares lleva comisión bancaria del 0.3%.', codigo: 400 }
      : { llevaComision: null };
  }
  if (pago.llevaComision && !comisionDisponible) return { error: MENSAJE_COMISION_PENDIENTE, codigo: 503 };
  return { llevaComision: pago.llevaComision };
}

function planDeCuenta(pago: PagoSolicitado, cuentas: readonly CuentaWallet[], comisionDisponible: boolean): PagoPlanificado | FalloPlan {
  const cuenta = cuentas.find(c => c.id === pago.bancaId);
  const invalida = validarCuenta(pago, cuenta);
  if (invalida) return invalida;
  const comision = comisionDe(pago, cuenta!, comisionDisponible);
  if ('error' in comision) return comision;
  return {
    moneda: pago.moneda, bancaId: pago.bancaId, llevaComision: comision.llevaComision,
    ...(pago.monto === undefined ? {} : { monto: pago.monto }),
  };
}

/** Cuentas de una moneda (en el orden recibido) con el reparto ya validado contra lo que se debe pagar en esa moneda. */
function repartoDeMoneda(moneda: MonedaPago, pagos: readonly PagoSolicitado[], totalCentavos: number): FalloPlan | null {
  const entradas: EntradaReparto[] = pagos.filter(p => p.moneda === moneda).map(p => ({ bancaId: p.bancaId, monto: p.monto }));
  const r = normalizarReparto(entradas, totalCentavos);
  return 'error' in r ? { error: `${ETIQUETA_MONEDA[moneda]}: ${r.error}`, codigo: r.codigo } : null;
}

/**
 * Valida que cada moneda a pagar tenga una o varias cuentas (de la moneda correcta, vigentes, sin repetirse) cuyo reparto sume
 * exactamente lo que se debe pagar, y resuelve la comisión de cada cuenta. Cualquier cuenta de la moneda sirve: no se
 * filtra por nombre ni por tipo de cuenta.
 */
export function planificarPagos(
  requeridas: readonly MonedaPago[],
  pagos: readonly PagoSolicitado[],
  cuentas: readonly CuentaWallet[],
  comisionDisponible: boolean,
  montos: MontosPorMoneda,
): { pagos: PagoPlanificado[] } | FalloPlan {
  const enviadas = [...new Set(pagos.map(p => p.moneda))].sort().join(',');
  if (enviadas !== [...requeridas].sort().join(',')) {
    return { error: `Elige una cuenta para cada moneda a pagar (${requeridas.map(m => ETIQUETA_MONEDA[m]).join(' y ')}).`, codigo: 400 };
  }
  for (const moneda of requeridas) {
    const problema = repartoDeMoneda(moneda, pagos, montos[moneda]);
    if (problema) return problema;
  }
  const resultado: PagoPlanificado[] = [];
  for (const pago of pagos) {
    const plan = planDeCuenta(pago, cuentas, comisionDisponible);
    if ('error' in plan) return plan;
    resultado.push(plan);
  }
  return { pagos: resultado };
}
