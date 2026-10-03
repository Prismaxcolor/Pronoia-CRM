/**
 * Cruce (compensación) de facturas con adelantos/anticipos y notas de
 * crédito/débito, en el pago a proveedor y el cobro a cliente.
 *
 * Lógica pura, sin dependencias — la usa el modal de pago/cobro y la prueban
 * los tests del backend. La función SQL aplica las mismas reglas con locks;
 * esto solo calcula y valida antes de enviar.
 *
 * Regla: facturas seleccionadas + notas de débito
 *        - adelantos - notas de crédito = monto a pagar en efectivo/banco.
 * Si ese monto es 0 el cruce es "puro": no mueve dinero ni usa método de pago.
 * Todo se calcula en centavos enteros para no arrastrar error de flotante.
 */

export type TipoItemCruce = 'factura' | 'nota_debito' | 'nota_credito' | 'adelanto';

export interface ItemCruce {
  tipo: TipoItemCruce;
  /** USD, positivo. */
  montoUsd: number;
}

export interface ResultadoCruce {
  totalFacturas: number;
  totalNotasDebito: number;
  /** Facturas + notas de débito. */
  totalCargos: number;
  totalAdelantos: number;
  totalNotasCredito: number;
  /** Adelantos + notas de crédito. */
  totalCreditos: number;
  /** Lo que hay que pagar en efectivo/banco (nunca negativo). */
  efectivo: number;
  /** Hay items y no se mueve dinero. */
  esCrucePuro: boolean;
  error: string | null;
}

/** Diferencia máxima (en centavos) que se trata como cero. */
const TOLERANCIA_CENTAVOS = 1;

function aCentavos(n: number): number {
  return Math.round(Number((n * 100).toPrecision(15)));
}

/** Redondea a 2 decimales (mitad hacia afuera) sin el error típico de flotante. */
export function redondear2(n: number): number {
  return aCentavos(n) / 100;
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function calcularCruce(items: ItemCruce[]): ResultadoCruce {
  const suma = { factura: 0, nota_debito: 0, nota_credito: 0, adelanto: 0 };
  let montoInvalido = false;

  for (const item of items) {
    if (!Number.isFinite(item.montoUsd) || aCentavos(item.montoUsd) <= 0) {
      montoInvalido = true;
      continue;
    }
    suma[item.tipo] += aCentavos(item.montoUsd);
  }

  const cargos = suma.factura + suma.nota_debito;
  const creditos = suma.nota_credito + suma.adelanto;
  const neto = cargos - creditos;

  let error: string | null = null;
  if (montoInvalido) {
    error = 'El monto de cada ítem debe ser mayor a 0.';
  } else if (creditos > cargos + TOLERANCIA_CENTAVOS) {
    error = `Los créditos aplicados ($${fmt(creditos / 100)}) superan lo que se paga ($${fmt(cargos / 100)}). Quitá algún adelanto o nota de crédito, o agregá más facturas.`;
  }

  const efectivoCentavos = error || Math.abs(neto) <= TOLERANCIA_CENTAVOS ? 0 : Math.max(0, neto);

  return {
    totalFacturas: suma.factura / 100,
    totalNotasDebito: suma.nota_debito / 100,
    totalCargos: cargos / 100,
    totalAdelantos: suma.adelanto / 100,
    totalNotasCredito: suma.nota_credito / 100,
    totalCreditos: creditos / 100,
    efectivo: efectivoCentavos / 100,
    esCrucePuro: !error && items.length > 0 && efectivoCentavos === 0,
    error,
  };
}

/** Monto sugerido al marcar un crédito: lo que falta por cubrir, acotado al disponible. */
export function sugerirMontoCredito(disponible: number, pendiente: number): number {
  if (pendiente <= 0 || disponible <= 0) return 0;
  return redondear2(Math.min(disponible, pendiente));
}

/** Mensaje de error si `monto` no cabe en `disponible` (tolerancia de un centavo); null si es válido. */
export function validarMontoAplicable(monto: number, disponible: number, nombre: string): string | null {
  if (!Number.isFinite(monto) || aCentavos(monto) <= 0) return `El monto de ${nombre} debe ser mayor a 0.`;
  if (aCentavos(monto) > aCentavos(disponible) + TOLERANCIA_CENTAVOS) {
    return `El monto de ${nombre} ($${fmt(monto)}) supera lo disponible ($${fmt(disponible)}).`;
  }
  return null;
}
