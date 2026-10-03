import { z } from 'zod';
import { bancaPagoSchema, itemPagoMultipleSchema } from './pagos.js';

/** Espejo de registrarPagoMultipleSchema (pagos.ts) para cobros a cliente —
 *  bancaPagoSchema/itemPagoMultipleSchema se reutilizan tal cual: no tienen
 *  ningún campo específico de proveedor, la forma es la misma para ambos. */
export const registrarCobroMultipleSchema = z.object({
  clienteId: z.string().uuid('Selecciona un cliente.'),
  bancas: z.array(bancaPagoSchema).min(1, 'Agregá al menos una banca.'),
  montoUsd: z.number().positive('El monto en USD debe ser mayor a 0.'),
  descripcion: z
    .string()
    .trim()
    .max(300)
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null)),
  referencia: z
    .string()
    .trim()
    .max(50)
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null)),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).'),
  items: z.array(itemPagoMultipleSchema).default([]),
  comprobantes: z.array(z.string().url('Comprobante inválido.')).default([]),
}).superRefine((data, ctx) => {
  const sumaBancas = data.bancas.reduce((acc, b) => acc + b.montoUsd, 0);
  if (Math.abs(sumaBancas - data.montoUsd) > 0.02) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['bancas'],
      message: `La suma de las bancas ($${sumaBancas.toFixed(2)}) no coincide con el total a cobrar ($${data.montoUsd.toFixed(2)}).`,
    });
  }

  const idsUnicos = new Set(data.bancas.map(b => b.bancaId));
  if (idsUnicos.size !== data.bancas.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['bancas'],
      message: 'No se puede repetir la misma banca en un cobro.',
    });
  }

  const sumaCargos = data.items.filter(i => i.tipo !== 'nota_credito').reduce((acc, i) => acc + i.montoUsd, 0);
  const sumaCreditos = data.items.filter(i => i.tipo === 'nota_credito').reduce((acc, i) => acc + i.montoUsd, 0);

  if (sumaCreditos > sumaCargos + 0.01) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['items'],
      message: `Las notas de crédito seleccionadas ($${sumaCreditos.toFixed(2)}) superan lo que se está cobrando ($${sumaCargos.toFixed(2)}).`,
    });
  }

  const sumaItems = sumaCargos - sumaCreditos;
  if (data.montoUsd < sumaItems - 0.01) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['montoUsd'],
      message: `El total a cobrar ($${data.montoUsd.toFixed(2)}) es menor a la suma de lo seleccionado ($${sumaItems.toFixed(2)}).`,
    });
  }
});

export type RegistrarCobroMultipleInput = z.infer<typeof registrarCobroMultipleSchema>;
