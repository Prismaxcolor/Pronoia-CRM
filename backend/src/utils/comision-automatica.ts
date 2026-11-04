/**
 * Comisión bancaria AUTOMÁTICA de una cuenta (p. ej. Citibank).
 *
 * Distinta de la comisión del Wallet para cuentas en Bs (0.3 %, mínimo 14 Bs), que la persona elige con Sí/No: aquí
 * la cuenta lleva su propia regla guardada en `bancas.comision_auto_tasa` y `bancas.comision_auto_minimo`
 * (docs/migration_comision_automatica_banca.sql) y la comisión se calcula y se carga SOLA cada vez que sale dinero de
 * esa cuenta (egreso, transferencia o pago a proveedor), sin preguntar y sin poder omitirla.
 *
 * Regla: comisión = mayor entre (monto x tasa) y el mínimo, a centavos (mitad hacia arriba), y nunca menos de 0.01.
 * Espejo de la fórmula de las RPC SQL (crear_movimiento_con_comision_bancaria y agregar_comision_bancaria_a_pago),
 * que son la autoridad. Todo en centavos enteros: nada de errores de coma flotante.
 */

export interface ReglaComisionAutomatica {
  /** Fracción del monto: 0.003 = 0.3 %. 0 si la comisión es solo un monto fijo (el mínimo). */
  tasa: number;
  /** Comisión mínima, en la moneda de la cuenta. 0 si es solo porcentaje. */
  minimo: number;
}

const CENTAVOS_POR_UNIDAD = 100;
const CIFRAS_SIGNIFICATIVAS = 12;

const aNumeroONull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Regla de una cuenta a partir de las columnas de `bancas`; null si la cuenta no tiene comisión automática. */
export function reglaDeBanca(fila: { comision_auto_tasa?: unknown; comision_auto_minimo?: unknown } | null | undefined): ReglaComisionAutomatica | null {
  if (!fila) return null;
  const tasa = aNumeroONull(fila.comision_auto_tasa);
  const minimo = aNumeroONull(fila.comision_auto_minimo);
  if (tasa === null && minimo === null) return null;
  const regla = { tasa: Math.max(0, tasa ?? 0), minimo: Math.max(0, minimo ?? 0) };
  return regla.tasa > 0 || regla.minimo > 0 ? regla : null;
}

/** Comisión (en la moneda de la cuenta) de un monto que sale de la cuenta. 0 si el monto no es positivo. */
export function calcularComisionAutomatica(monto: number, regla: ReglaComisionAutomatica): number {
  if (!Number.isFinite(monto) || monto <= 0) return 0;
  const centavos = Math.round(monto * CENTAVOS_POR_UNIDAD);
  const porTasa = Math.round(Number((centavos * regla.tasa).toPrecision(CIFRAS_SIGNIFICATIVAS)));
  const minimo = Math.round(regla.minimo * CENTAVOS_POR_UNIDAD);
  return Math.max(porTasa, minimo, 1) / CENTAVOS_POR_UNIDAD;
}

/** Total que se debita de la cuenta: el monto más su comisión. */
export function totalConComisionAutomatica(monto: number, regla: ReglaComisionAutomatica): number {
  return Math.round(monto * CENTAVOS_POR_UNIDAD + calcularComisionAutomatica(monto, regla) * CENTAVOS_POR_UNIDAD) / CENTAVOS_POR_UNIDAD;
}
