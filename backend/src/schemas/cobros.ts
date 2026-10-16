import { z } from 'zod';
import { comprobanteUrlSchema } from './comprobantes.js';
import { bancaPagoSchema, itemPagoMultipleSchema } from './pagos.js';
import { validarPagoCombinado } from './pago-combinado.js';

/** Espejo de registrarPagoMultipleSchema (pagos.ts) para cobros a cliente —
 *  bancaPagoSchema/itemPagoMultipleSchema se reutilizan tal cual: no tienen
 *  ningún campo específico de proveedor, la forma es la misma para ambos. */
export const registrarCobroMultipleSchema = z.object({
  clienteId: z.string().uuid('Selecciona un cliente.'),
  bancas: z.array(bancaPagoSchema).default([]),
  montoUsd: z.number().min(0, 'El monto en USD no puede ser negativo.'),
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
  comprobantes: z.array(comprobanteUrlSchema).default([]),
  /** Categoría del Wallet (venta de chatarra NF / PCB). El servicio la exige si hay categorías configuradas y el cobro mueve dinero. */
  categoriaId: z.string().uuid('Categoría inválida.').optional().nullable(),
}).superRefine((data, ctx) => validarPagoCombinado(data, ctx, 'cobro'));

export type RegistrarCobroMultipleInput = z.infer<typeof registrarCobroMultipleSchema>;
