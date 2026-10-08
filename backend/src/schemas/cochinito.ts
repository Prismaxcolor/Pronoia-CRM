import { z } from 'zod';
import { comprobanteUrlSchema } from './comprobantes.js';
import { esColorBancaValido, normalizarColorBanca } from '../utils/color-banca.js';

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null));

/** Clave de la paleta o hex #RRGGBB. Opcional; null = sin color. */
const colorBancaSchema = z
  .string()
  .transform(normalizarColorBanca)
  .refine(esColorBancaValido, 'Color inválido: usa un color de la paleta.')
  .nullable()
  .optional();

export const crearBancaSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(100),
  tipo: z.enum(['banco_nacional', 'banco_internacional', 'exchange', 'efectivo']),
  moneda: z.string().trim().min(1, 'La moneda es obligatoria.').max(10),
  descripcion: textoOpcional(200),
  color: colorBancaSchema,
});

export const actualizarBancaSchema = z.object({
  nombre: z.string().trim().min(1).max(100).optional(),
  tipo: z.enum(['banco_nacional', 'banco_internacional', 'exchange', 'efectivo']).optional(),
  descripcion: textoOpcional(200),
  color: colorBancaSchema,
});

export const crearMovimientoSchema = z.object({
  tipo: z.enum(['ingreso', 'egreso', 'transferencia']),
  /** Banca origen (ingreso: destino de los fondos; egreso/transferencia: de dónde salen). */
  bancaId: z.string().uuid('Selecciona una banca.'),
  /** Solo transferencia: banca que recibe los fondos. */
  bancaDestinoId: z.string().uuid('Banca destino inválida.').optional().nullable(),
  monto: z.number().positive('El monto debe ser mayor a 0.'),
  /** Solo transferencia entre monedas distintas: lo que entra a la banca destino. */
  montoDestino: z.number().positive('El monto destino debe ser mayor a 0.').optional().nullable(),
  moneda: z.string().trim().min(1).max(10),
  descripcion: textoOpcional(200),
  referencia: textoOpcional(50),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).'),
  proveedorId: z.string().uuid('Proveedor inválido.').optional().nullable(),
  clienteId: z.string().uuid('Cliente inválido.').optional().nullable(),
  /** Imagen(es) OPCIONAL(es) del comprobante, ya subidas vía POST /api/uploads/comprobantes. */
  comprobantes: z.array(comprobanteUrlSchema).max(10, 'Máximo 10 comprobantes.').default([]),
}).superRefine((data, ctx) => {
  if (data.tipo !== 'transferencia') return;
  if (!data.bancaDestinoId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bancaDestinoId'], message: 'Selecciona la banca destino.' });
    return;
  }
  if (data.bancaDestinoId === data.bancaId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bancaDestinoId'], message: 'La banca destino debe ser distinta de la de origen.' });
  }
});

export type CrearBancaInput = z.infer<typeof crearBancaSchema>;
export type ActualizarBancaInput = z.infer<typeof actualizarBancaSchema>;
export type CrearMovimientoInput = z.infer<typeof crearMovimientoSchema>;
