/**
 * Resumen del comprobante de pago/cobro/cruce: ÚNICO lugar donde se calcula.
 * La pantalla, el PDF del frontend y el PDF de Telegram solo dibujan estas filas.
 *
 * Orden: total de las facturas, notas de débito, adelantos/anticipos y notas de crédito
 * (solo los que se aplicaron), saldo pendiente y, al final, lo pagado.
 * Con los datos reales de las facturas (`facturas`: total y monto_pagado acumulado, ya con esta
 * operación aplicada): Total = suma del total de cada factura involucrada y Saldo pendiente =
 * lo que esas facturas siguen debiendo después de la operación (total - pagado acumulado, que
 * ya incluye efectivo, adelantos y N/C). Ej.: factura 1000, pago de 400 => Total 1000,
 * Saldo pendiente 600, Pagado 400. Las N/D aplicadas se pagaron en la operación y no dejan saldo.
 * Sin `facturas` (datos antiguos) cae a lo aplicado: facturas + N/D - adelantos - N/C (la misma
 * regla de calcularCruce en frontend/src/lib/cruce.ts; backend/tests/comprobante-resumen.test.ts
 * las compara).
 * Pagado = dinero que salió/entró por banca (0 en un cruce puro).
 * Todo en centavos enteros para no arrastrar error de flotante.
 */

export type TipoItemComprobante = 'factura' | 'nota_debito' | 'nota_credito' | 'adelanto';

export type ClaveFilaComprobante = 'totalFacturas' | 'notasDebito' | 'adelantos' | 'notasCredito' | 'saldoPendiente' | 'pagado';

export interface FilaComprobante {
  clave: ClaveFilaComprobante;
  etiqueta: string;
  /** USD, nunca negativo; `signo` dice si suma o resta. */
  montoUsd: number;
  signo: '' | '+' | '-';
}

/** Diferencia máxima (en centavos) que se trata como cero. */
const TOLERANCIA_CENTAVOS = 1;

function aCentavos(n: number): number {
  return Number.isFinite(n) ? Math.round(Number((n * 100).toPrecision(15))) : 0;
}

function sumaPorTipo(items: ReadonlyArray<{ tipo: TipoItemComprobante; montoUsd: number }>): Record<TipoItemComprobante, number> {
  const suma: Record<TipoItemComprobante, number> = { factura: 0, nota_debito: 0, nota_credito: 0, adelanto: 0 };
  for (const it of items) suma[it.tipo] += aCentavos(it.montoUsd);
  return suma;
}

/** Factura involucrada con su total real y lo pagado acumulado (incluida la operación). */
export interface FacturaComprobante {
  total: number;
  montoPagado: number;
}

export function resumenComprobante(
  items: ReadonlyArray<{ tipo: TipoItemComprobante; montoUsd: number }>,
  pagadoUsd: number,
  esProveedor: boolean,
  facturas: ReadonlyArray<FacturaComprobante> = []
): FilaComprobante[] {
  const pagado: FilaComprobante = { clave: 'pagado', etiqueta: 'Pagado', montoUsd: aCentavos(pagadoUsd) / 100, signo: '' };
  if (items.length === 0) return [pagado];

  const s = sumaPorTipo(items);
  const usaFacturasReales = facturas.length > 0;
  const totalFacturas = usaFacturasReales ? facturas.reduce((acc, f) => acc + aCentavos(f.total), 0) : s.factura;
  const neto = usaFacturasReales
    ? facturas.reduce((acc, f) => {
        const resta = aCentavos(f.total) - aCentavos(f.montoPagado);
        return acc + (resta <= TOLERANCIA_CENTAVOS ? 0 : resta);
      }, 0)
    : s.factura + s.nota_debito - s.adelanto - s.nota_credito;
  const saldo = neto <= TOLERANCIA_CENTAVOS ? 0 : neto;
  const candidatas: FilaComprobante[] = [
    { clave: 'totalFacturas', etiqueta: 'Total de las facturas', montoUsd: totalFacturas / 100, signo: '' },
    { clave: 'notasDebito', etiqueta: 'Notas de débito', montoUsd: s.nota_debito / 100, signo: '+' },
    { clave: 'adelantos', etiqueta: esProveedor ? 'Adelantos aplicados' : 'Anticipos aplicados', montoUsd: s.adelanto / 100, signo: '-' },
    { clave: 'notasCredito', etiqueta: 'Notas de crédito', montoUsd: s.nota_credito / 100, signo: '-' },
  ];
  const aplicadas = candidatas.filter(f => f.clave === 'totalFacturas' || f.montoUsd > 0);
  return [...aplicadas, { clave: 'saldoPendiente', etiqueta: 'Saldo pendiente', montoUsd: saldo / 100, signo: '' }, pagado];
}
