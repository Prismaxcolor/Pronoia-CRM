/** Textos de la tabla y de los totales del PDF de la nómina (lógica pura, sin jsPDF). */
import type { LineaNomina, Nomina, TotalesNomina } from '../../../../shared/types/nomina.js';
import { estadoPagoNomina, modoPagoNomina, resumenPagoTrabajadores } from './nomina-pago';

const numero = (n: number): string => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtUsdPdf = (n: number): string => `USD ${numero(n)}`;
export const fmtBsPdf = (n: number | null): string => (n === null ? '-' : `Bs ${numero(n)}`);

export const ENCABEZADO_TABLA_PDF = [
  'Trabajador', 'Días', 'Sueldo USD/día', 'Sueldo Bs (ref. USD)/día', 'Bruto USD', 'Bonif. USD', 'Bonif. Bs (ref. USD)', 'Desc. USD', 'A pagar USD', 'A pagar Bs', 'Total USD',
];

/** Posiciones (desde 0) de las columnas numéricas del PDF: se alinean a la derecha. */
export const COLUMNAS_NUMERICAS_PDF = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export function filaDeLinea(l: LineaNomina): string[] {
  return [
    l.trabajadorNombre,
    String(l.diasTrabajados).replace('.', ','),
    numero(l.montoBaseUsd),
    numero(l.montoBaseBs),
    numero(l.totalBrutoUsd),
    numero(l.bonificacionUsd),
    numero(l.bonificacionBsUsd),
    numero(l.descuentoTrabajoUsd + l.descuentoPrestamoUsd),
    numero(l.pagarUsd),
    l.pagarBs === null ? '-' : numero(l.pagarBs),
    numero(l.totalUsd),
  ];
}

export function filasTabla(nomina: Nomina): string[][] {
  return nomina.lineas.map(filaDeLinea);
}

/** Pares etiqueta / valor del resumen de totales, en el orden pedido por el cliente. */
export function filasTotales(t: TotalesNomina): Array<[string, string]> {
  return [
    [`Total a pagar en divisas (${t.cantidadDivisas} trabajador${t.cantidadDivisas === 1 ? '' : 'es'} con sueldo en USD)`, fmtUsdPdf(t.totalDivisasUsd)],
    [`Total a pagar en Bs (${t.cantidadBs} trabajador${t.cantidadBs === 1 ? '' : 'es'} con sueldo en Bs)`, fmtBsPdf(t.totalBs)],
    ['Equivalente en USD de los Bs', fmtUsdPdf(t.equivalenteUsdDeBs)],
    ['Total combinado en USD', fmtUsdPdf(t.totalCombinadoUsd)],
    ['Total combinado en Bs', fmtBsPdf(t.totalCombinadoBs)],
  ];
}

/** ¿La nómina quedó pagada por completo? Pago completo vigente, o todos los trabajadores con algo que cobrar ya pagados. */
export function nominaPagadaPorCompleto(nomina: Pick<Nomina, 'pagos' | 'lineas'>): boolean {
  if (estadoPagoNomina(nomina.pagos) !== 'pagada') return false;
  if (modoPagoNomina(nomina.pagos) !== 'por-trabajador') return true;
  const { pagados, total } = resumenPagoTrabajadores(nomina);
  return total > 0 && pagados === total;
}

/**
 * Fila del estado del pago (vacía si la nómina no se ha pagado). El PDF NO detalla cuentas, montos ni movimientos del Wallet:
 * solo dice que está correctamente pagada (o, si falta gente, cuántos trabajadores van pagados; o que el pago se anuló).
 */
export function filasPagos(nomina: Pick<Nomina, 'pagos' | 'lineas'>): Array<[string, string]> {
  const estado = estadoPagoNomina(nomina.pagos);
  if (estado === 'sin-pagar') return [];
  if (estado === 'pago-anulado') return [['Estado del pago', 'Pago anulado']];
  if (nominaPagadaPorCompleto(nomina)) return [['Estado del pago', 'Pagada correctamente']];
  const { pagados, total } = resumenPagoTrabajadores(nomina);
  return [['Estado del pago', `Pago parcial: ${pagados} de ${total} trabajadores pagados`]];
}
