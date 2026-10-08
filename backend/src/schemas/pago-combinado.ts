import { z } from 'zod';

/** Datos mínimos que comparten el pago a proveedor y el cobro a cliente para
 *  validar el cruce de ítems contra el efectivo/banco. */
interface DatosPagoCombinado {
  bancas: Array<{ bancaId: string; montoUsd: number }>;
  montoUsd: number;
  items: Array<{ tipo: 'factura' | 'nota_debito' | 'nota_credito' | 'adelanto'; montoUsd: number }>;
}

const aCentavos = (n: number): number => Math.round(Number((n * 100).toPrecision(15)));
const usd = (centavos: number): string => (centavos / 100).toFixed(2);

/**
 * Validaciones cruzadas del "Registrar pago"/"Registrar cobro" combinado
 * (la RPC SQL las repite con locks). `verbo`: 'pago' | 'cobro'.
 *
 * Facturas y notas de débito suman; notas de crédito y adelantos/anticipos
 * restan. Lo que queda es el efectivo/banco. Efectivo = 0 es un cruce puro:
 * sin bancas y sin movimiento de dinero.
 */
export function validarPagoCombinado(data: DatosPagoCombinado, ctx: z.RefinementCtx, verbo: 'pago' | 'cobro'): void {
  const total = verbo === 'pago' ? 'pagar' : 'cobrar';
  const gerundio = verbo === 'pago' ? 'pagando' : 'cobrando';
  const caso = verbo === 'pago' ? 'un pago' : 'un cobro';

  const sumaBancas = data.bancas.reduce((acc, b) => acc + b.montoUsd, 0);
  if (Math.abs(sumaBancas - data.montoUsd) > 0.02) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['bancas'],
      message: `La suma de las bancas ($${sumaBancas.toFixed(2)}) no coincide con el total a ${total} ($${data.montoUsd.toFixed(2)}).`,
    });
  }

  if (new Set(data.bancas.map(b => b.bancaId)).size !== data.bancas.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['bancas'],
      message: `No se puede repetir la misma banca en ${caso}.`,
    });
  }

  // Sin bancas solo vale un cruce puro: total 0 y al menos un ítem.
  if (data.bancas.length === 0 && (aCentavos(data.montoUsd) > 1 || data.items.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['bancas'],
      message: 'Agregá al menos una banca.',
    });
  }

  const cargos = data.items
    .filter(i => i.tipo === 'factura' || i.tipo === 'nota_debito')
    .reduce((acc, i) => acc + aCentavos(i.montoUsd), 0);
  const creditos = data.items
    .filter(i => i.tipo === 'nota_credito' || i.tipo === 'adelanto')
    .reduce((acc, i) => acc + aCentavos(i.montoUsd), 0);

  if (creditos > cargos + 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['items'],
      message: `Los créditos aplicados (notas de crédito y adelantos: $${usd(creditos)}) superan lo que se está ${gerundio} ($${usd(cargos)}).`,
    });
  }

  const sumaItems = cargos - creditos;
  if (aCentavos(data.montoUsd) < sumaItems - 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['montoUsd'],
      message: `El total a ${total} ($${data.montoUsd.toFixed(2)}) es menor a la suma de lo seleccionado ($${usd(sumaItems)}).`,
    });
  }
}
