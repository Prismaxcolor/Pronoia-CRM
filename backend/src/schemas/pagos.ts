import { z } from 'zod';

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null));

/** Pago a un proveedor. Siempre se contabiliza en USD; `monto`/`moneda`
 *  reflejan lo que realmente sale de la banca de origen (puede ser Bs). */
export const registrarPagoSchema = z.object({
  proveedorId: z.string().uuid('Selecciona un proveedor.'),
  bancaId: z.string().uuid('Selecciona una banca.'),
  monto: z.number().positive('El monto debe ser mayor a 0.'),
  moneda: z.enum(['USD', 'VES']),
  montoUsd: z.number().positive('El monto en USD debe ser mayor a 0.'),
  descripcion: textoOpcional(200),
  referencia: textoOpcional(50),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).'),
  /** Factura a la que se aplica el pago. Si se omite, es un adelanto. */
  facturaId: z.string().uuid('Factura inválida.').optional().nullable(),
  /** URLs de los comprobantes ya subidos vía POST /api/uploads/comprobantes. */
  comprobantes: z.array(z.string().url('Comprobante inválido.')).default([]),
});

export type RegistrarPagoInput = z.infer<typeof registrarPagoSchema>;

/** Un ítem del pago combinado: factura o nota de débito a liquidar (suman al
 *  total a cubrir con banca), o nota de crédito aplicada como método de pago
 *  (resta del total a cubrir con banca) — con el monto (USD) que le corresponde. */
export const itemPagoMultipleSchema = z.object({
  tipo: z.enum(['factura', 'nota_debito', 'nota_credito']),
  id: z.string().uuid('Ítem inválido.'),
  montoUsd: z.number().positive('El monto de cada ítem debe ser mayor a 0.'),
});

/** Una banca de origen del pago combinado, con el monto (en su propia
 *  moneda y en USD) que aporta de este pago. */
export const bancaPagoSchema = z.object({
  bancaId: z.string().uuid('Selecciona una banca.'),
  monto: z.number().positive('El monto debe ser mayor a 0.'),
  moneda: z.enum(['USD', 'VES']),
  montoUsd: z.number().positive('El monto en USD debe ser mayor a 0.'),
  /** Referencia propia de esta banca (ej. número de transferencia). */
  referencia: textoOpcional(50),
});

/** Pago combinado ("Registrar pago"): puede repartirse entre varias bancas de
 *  origen, liquida varias facturas y/o notas de débito a la vez, y el
 *  excedente del total sobre la suma de esos ítems se registra aparte como
 *  adelanto (lo separa la RPC, no el frontend). */
export const registrarPagoMultipleSchema = z.object({
  proveedorId: z.string().uuid('Selecciona un proveedor.'),
  bancas: z.array(bancaPagoSchema).min(1, 'Agregá al menos una banca.'),
  montoUsd: z.number().positive('El monto en USD debe ser mayor a 0.'),
  descripcion: textoOpcional(300),
  referencia: textoOpcional(50),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).'),
  items: z.array(itemPagoMultipleSchema).default([]),
  comprobantes: z.array(z.string().url('Comprobante inválido.')).default([]),
}).superRefine((data, ctx) => {
  const sumaBancas = data.bancas.reduce((acc, b) => acc + b.montoUsd, 0);
  if (Math.abs(sumaBancas - data.montoUsd) > 0.02) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['bancas'],
      message: `La suma de las bancas ($${sumaBancas.toFixed(2)}) no coincide con el total a pagar ($${data.montoUsd.toFixed(2)}).`,
    });
  }

  const idsUnicos = new Set(data.bancas.map(b => b.bancaId));
  if (idsUnicos.size !== data.bancas.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['bancas'],
      message: 'No se puede repetir la misma banca en un pago.',
    });
  }

  // Las notas de crédito restan del total a cubrir con banca (al revés de
  // facturas/notas de débito, que suman) — mismo criterio que la RPC.
  const sumaCargos = data.items.filter(i => i.tipo !== 'nota_credito').reduce((acc, i) => acc + i.montoUsd, 0);
  const sumaCreditos = data.items.filter(i => i.tipo === 'nota_credito').reduce((acc, i) => acc + i.montoUsd, 0);

  if (sumaCreditos > sumaCargos + 0.01) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['items'],
      message: `Las notas de crédito seleccionadas ($${sumaCreditos.toFixed(2)}) superan lo que se está pagando ($${sumaCargos.toFixed(2)}).`,
    });
  }

  const sumaItems = sumaCargos - sumaCreditos;
  if (data.montoUsd < sumaItems - 0.01) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['montoUsd'],
      message: `El total a pagar ($${data.montoUsd.toFixed(2)}) es menor a la suma de lo seleccionado ($${sumaItems.toFixed(2)}).`,
    });
  }
});

export type BancaPagoInput = z.infer<typeof bancaPagoSchema>;
export type ItemPagoMultipleInput = z.infer<typeof itemPagoMultipleSchema>;
export type RegistrarPagoMultipleInput = z.infer<typeof registrarPagoMultipleSchema>;
