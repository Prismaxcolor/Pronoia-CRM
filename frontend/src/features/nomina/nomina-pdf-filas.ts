/** Textos de la tabla y de los totales del PDF de la nómina (lógica pura, sin jsPDF). */
import type { LineaNomina, Nomina, TotalesNomina } from '../../../../shared/types/nomina.js';
import { lineaDePago } from './nomina-pago';

const numero = (n: number): string => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtUsdPdf = (n: number): string => `USD ${numero(n)}`;
export const fmtBsPdf = (n: number | null): string => (n === null ? '-' : `Bs ${numero(n)}`);

export const ENCABEZADO_TABLA_PDF = [
  'Trabajador', 'Pago en', 'Días', 'Base USD', 'Bruto USD', 'Ref. Bs', 'Bonif. USD', 'Desc. USD', 'Total USD', 'Total Bs',
];

export function filaDeLinea(l: LineaNomina): string[] {
  return [
    l.trabajadorNombre,
    l.monedaPago === 'USD' ? 'Divisas' : 'Bs',
    String(l.diasTrabajados).replace('.', ','),
    numero(l.montoBaseUsd),
    numero(l.totalBrutoUsd),
    l.montoRefBs === null ? '-' : numero(l.montoRefBs),
    numero(l.bonificacionUsd),
    numero(l.descuentoTrabajoUsd + l.descuentoPrestamoUsd),
    numero(l.totalUsd),
    l.totalBs === null ? '-' : numero(l.totalBs),
  ];
}

export function filasTabla(nomina: Nomina): string[][] {
  return nomina.lineas.map(filaDeLinea);
}

/** Pares etiqueta / valor del resumen de totales, en el orden pedido por el cliente. */
export function filasTotales(t: TotalesNomina): Array<[string, string]> {
  return [
    [`Total a pagar en divisas (${t.cantidadDivisas} trabajador${t.cantidadDivisas === 1 ? '' : 'es'})`, fmtUsdPdf(t.totalDivisasUsd)],
    [`Total a pagar en Bs (${t.cantidadBs} trabajador${t.cantidadBs === 1 ? '' : 'es'})`, fmtBsPdf(t.totalBs)],
    ['Equivalente en USD de los Bs', fmtUsdPdf(t.equivalenteUsdDeBs)],
    ['Total combinado en USD', fmtUsdPdf(t.totalCombinadoUsd)],
    ['Total combinado en Bs', fmtBsPdf(t.totalCombinadoBs)],
  ];
}

/** Pares etiqueta / valor del pago desde el Wallet (vacío si la nómina no se ha pagado). Solo cuenta, monto y fecha. */
export function filasPagos(nomina: Pick<Nomina, 'pagos'>): Array<[string, string]> {
  return nomina.pagos.map(p => [p.anulado ? 'Pago anulado' : 'Pagada', lineaDePago(p)]);
}
