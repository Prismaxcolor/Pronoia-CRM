/**
 * Pagar una nómina cerrada desde el Wallet (fase 2): reglas puras para validar las cuentas elegidas antes de llamar a la
 * función SQL nomina_pagar, que es la autoridad (vuelve a validar cuentas, monedas, saldo y comisión).
 */
import { aplicaComisionBancaria } from './comision-bancaria.js';
import type { MonedaPago } from './nomina-calculo.js';

export const MENSAJE_COMISION_PENDIENTE =
  'La comisión bancaria aún no está habilitada en la base de datos (falta aplicar migration_wallet_comision_bancaria.sql).';

export const MENSAJE_PAGO_NO_HABILITADO =
  'El pago de nómina desde el Wallet aún no está habilitado en la base de datos (falta aplicar migration_nomina_pago_wallet.sql).';

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
}

/** Lo que recibe la función SQL por cada moneda: `llevaComision` es null cuando no aplica o no se ofrece. */
export interface PagoPlanificado {
  moneda: MonedaPago;
  bancaId: string;
  llevaComision: boolean | null;
}

export interface FalloPlan {
  error: string;
  codigo: number;
}

/**
 * Monedas con algo que pagar: divisas si la suma de lo que se paga en USD es mayor a cero, bolívares si la de Bs lo es.
 * Un trabajador con las dos partes aporta a las dos monedas.
 */
export function monedasPorPagar(lineas: ReadonlyArray<{ pagarUsd: number; pagarBs: number | null }>): MonedaPago[] {
  const centavos = (n: number): number => Math.round(n * 100);
  const totalUsd = lineas.reduce((s, l) => s + centavos(l.pagarUsd), 0);
  const totalBs = lineas.reduce((s, l) => s + centavos(l.pagarBs ?? 0), 0);
  return [...(totalUsd > 0 ? ['USD' as const] : []), ...(totalBs > 0 ? ['BS' as const] : [])];
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
function comisionDe(pago: PagoSolicitado, cuenta: CuentaWallet, comisionDisponible: boolean): { llevaComision: boolean | null } | FalloPlan {
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

/** Valida que haya una cuenta (de la moneda correcta, vigente) por cada moneda a pagar y resuelve la comisión de cada una. */
export function planificarPagos(
  requeridas: readonly MonedaPago[],
  pagos: readonly PagoSolicitado[],
  cuentas: readonly CuentaWallet[],
  comisionDisponible: boolean,
): { pagos: PagoPlanificado[] } | FalloPlan {
  const enviadas = pagos.map(p => p.moneda).sort().join(',');
  if (enviadas !== [...requeridas].sort().join(',')) {
    return { error: `Elige una cuenta para cada moneda a pagar (${requeridas.map(m => ETIQUETA_MONEDA[m]).join(' y ')}).`, codigo: 400 };
  }
  const resultado: PagoPlanificado[] = [];
  for (const pago of pagos) {
    const cuenta = cuentas.find(c => c.id === pago.bancaId);
    const invalida = validarCuenta(pago, cuenta);
    if (invalida) return invalida;
    const comision = comisionDe(pago, cuenta!, comisionDisponible);
    if ('error' in comision) return comision;
    resultado.push({ moneda: pago.moneda, bancaId: pago.bancaId, llevaComision: comision.llevaComision });
  }
  return { pagos: resultado };
}
