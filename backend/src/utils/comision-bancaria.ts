/**
 * Comisión bancaria de los movimientos de Wallet que debitan una cuenta en bolívares (VES).
 * Espejo de shared/types/comision-bancaria.ts (se duplica porque @shared no resuelve en runtime con
 * tsx + ESM; un test comprueba que ambas copias dan lo mismo). La autoridad es la RPC SQL
 * crear_movimiento_con_comision_bancaria (docs/migration_wallet_comision_bancaria.sql).
 *
 * Regla del cliente: comisión = max(monto x 0.3%, 14 Bs), a 2 decimales, cargada a la MISMA cuenta.
 */

/** 0.3% expresado en milésimas: se calcula con enteros para no arrastrar errores de coma flotante. */
export const MILESIMAS_COMISION_BANCARIA = 3;
export const TASA_COMISION_BANCARIA = MILESIMAS_COMISION_BANCARIA / 1000;
export const MINIMO_COMISION_BANCARIA_BS = 14;
export const MONEDA_COMISION_BANCARIA = 'VES';

const CENTAVOS_POR_UNIDAD = 100;
const ETIQUETA_PORCENTAJE = `${MILESIMAS_COMISION_BANCARIA / 10}%`;

export type TipoMovimientoComision = 'ingreso' | 'egreso' | 'transferencia';

/** Comisión en Bs de un monto en Bs: el mayor entre el 0.3% y el mínimo, redondeada (mitad hacia arriba) a centavos. */
export function calcularComisionBancaria(monto: number): number {
  if (!Number.isFinite(monto) || monto <= 0) return 0;
  const centavos = Math.round(monto * CENTAVOS_POR_UNIDAD);
  const porTasa = Math.round((centavos * MILESIMAS_COMISION_BANCARIA) / 1000);
  return Math.max(porTasa, MINIMO_COMISION_BANCARIA_BS * CENTAVOS_POR_UNIDAD) / CENTAVOS_POR_UNIDAD;
}

/** Solo los movimientos que sacan dinero de una cuenta en Bs pueden llevar la comisión. */
export function aplicaComisionBancaria(tipo: TipoMovimientoComision, monedaOrigen: string): boolean {
  return tipo !== 'ingreso' && monedaOrigen === MONEDA_COMISION_BANCARIA;
}

export interface EntradaPlanComision {
  tipo: TipoMovimientoComision;
  moneda: string;
  monto: number;
  /** null = la persona aún no eligió Sí o No. */
  lleva: boolean | null;
  saldo: number;
}

export type PlanComisionBancaria =
  | { ok: true; aplica: false; comision: 0; totalDebitado: number }
  | { ok: true; aplica: true; lleva: boolean; comision: number; totalDebitado: number }
  | { ok: false; error: string };

const bs = (n: number): string => `Bs ${n.toFixed(2)}`;

/** Valida la elección y calcula la comisión y el total que se debitará de la cuenta. */
export function planificarComisionBancaria(e: EntradaPlanComision): PlanComisionBancaria {
  if (!aplicaComisionBancaria(e.tipo, e.moneda)) return { ok: true, aplica: false, comision: 0, totalDebitado: e.monto };
  if (e.lleva === null) return { ok: false, error: `Indica si el movimiento lleva comisión bancaria del ${ETIQUETA_PORCENTAJE}.` };
  const comision = e.lleva ? calcularComisionBancaria(e.monto) : 0;
  const totalDebitado = Math.round((e.monto + comision) * CENTAVOS_POR_UNIDAD) / CENTAVOS_POR_UNIDAD;
  if (totalDebitado > e.saldo) {
    return {
      ok: false,
      error: `Saldo insuficiente: el monto más la comisión bancaria de ${bs(comision)} suman ${bs(totalDebitado)} y el disponible es ${bs(e.saldo)}.`,
    };
  }
  return { ok: true, aplica: true, lleva: e.lleva, comision, totalDebitado };
}
