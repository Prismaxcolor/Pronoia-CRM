import { z } from 'zod';
import { comprobanteUrlSchema } from './comprobantes.js';
import { esColorBancaValido, normalizarColorBanca } from '../utils/color-banca.js';
import { ENV } from '../config/env.js';
import { esUrlDeBucketValida } from '../utils/comprobante-url.js';
import { clienteOperacionCampos } from './cliente-operacion.js';
import { esFechaReal, MENSAJE_FECHA_INEXISTENTE } from '../utils/fecha-calendario.js';

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

/** Extensiones que el endpoint de subida asigna según la firma real del archivo (nunca SVG). */
const EXTENSION_IMAGEN_BANCA = /\.(jpe?g|png|webp)$/i;

/** URL de una imagen subida vía POST /api/uploads/bancas (bucket "bancas"). Opcional; null = sin imagen. */
const imagenBancaSchema = z
  .string()
  .url('Imagen inválida.')
  .refine(u => esUrlDeBucketValida(u, ENV.SUPABASE_URL, 'bancas') && EXTENSION_IMAGEN_BANCA.test(u), 'Imagen inválida.')
  .nullable()
  .optional();

/** Id numérico del chat de Telegram al que van los avisos de la banca (grupos: negativo). '' o null = grupo general. */
const telegramChatIdSchema = z
  .string()
  .trim()
  .transform(v => (v === '' ? null : v))
  .refine(v => v === null || /^-?\d{5,20}$/.test(v), 'El id del grupo de Telegram debe ser numérico (ej. -1001234567890).')
  .nullable()
  .optional();

export const crearBancaSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(100),
  tipo: z.enum(['banco_nacional', 'banco_internacional', 'exchange', 'efectivo']),
  moneda: z.string().trim().min(1, 'La moneda es obligatoria.').max(10),
  descripcion: textoOpcional(200),
  color: colorBancaSchema,
  imagenUrl: imagenBancaSchema,
  telegramChatId: telegramChatIdSchema,
  telegramReportesActivos: z.boolean().optional(),
});

export const actualizarBancaSchema = z.object({
  nombre: z.string().trim().min(1).max(100).optional(),
  tipo: z.enum(['banco_nacional', 'banco_internacional', 'exchange', 'efectivo']).optional(),
  descripcion: textoOpcional(200),
  color: colorBancaSchema,
  imagenUrl: imagenBancaSchema,
  telegramChatId: telegramChatIdSchema,
  telegramReportesActivos: z.boolean().optional(),
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
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).').refine(esFechaReal, MENSAJE_FECHA_INEXISTENTE),
  proveedorId: z.string().uuid('Proveedor inválido.').optional().nullable(),
  clienteId: z.string().uuid('Cliente inválido.').optional().nullable(),
  /** Imagen(es) OPCIONAL(es) del comprobante, ya subidas vía POST /api/uploads/comprobantes. */
  comprobantes: z.array(comprobanteUrlSchema).max(10, 'Máximo 10 comprobantes.').default([]),
  /** Categoría o subcategoría del Wallet (ingreso o egreso). Opcional: sin valor = sin categoría. */
  categoriaId: z.string().uuid('Categoría inválida.').optional().nullable(),
  /** Egreso o transferencia desde una cuenta en Bs: si lleva la comisión bancaria del 0.3% (mínimo 14 Bs). Sin valor por defecto. */
  llevaComision: z.boolean().optional(),
  /** Idempotencia: un doble clic o reintento con el mismo id no registra el movimiento dos veces. */
  ...clienteOperacionCampos,
}).superRefine((data, ctx) => {
  if (data.tipo !== 'transferencia') return;
  if (data.categoriaId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['categoriaId'], message: 'Las transferencias no llevan categoría.' });
  }
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
