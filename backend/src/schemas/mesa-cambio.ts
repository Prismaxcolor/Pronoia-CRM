import { z } from 'zod';

const textoOpcional = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform(v => (v && v.length > 0 ? v : null));

const emailOpcional = z
  .string()
  .trim()
  .max(120)
  .optional()
  .nullable()
  .transform(v => (v && v.length > 0 ? v : null))
  .refine(v => v === null || z.string().email().safeParse(v).success, 'Email inválido.');

const nombreCambista = z.string().trim().min(1, 'El nombre es obligatorio.').max(120);

const fechaNegocio = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).');

export const crearCambistaSchema = z.object({
  nombre: nombreCambista,
  telefono: textoOpcional(40),
  email: emailOpcional,
  notas: textoOpcional(500),
});
export type CrearCambistaInput = z.infer<typeof crearCambistaSchema>;

export const actualizarCambistaSchema = z.object({
  nombre: nombreCambista.optional(),
  telefono: textoOpcional(40),
  email: emailOpcional,
  notas: textoOpcional(500),
  activo: z.boolean().optional(),
});
export type ActualizarCambistaInput = z.infer<typeof actualizarCambistaSchema>;

/** Sin valor por defecto: el tipo de asiento hay que elegirlo. */
export const crearAsientoSchema = z.object({
  cambistaId: z.string().uuid('Cambista inválido.'),
  tipo: z.enum(['CARGO', 'COBRO', 'NC', 'ND'], { message: 'Elige el tipo de asiento (cargo, cobro, nota de crédito o nota de débito).' }),
  montoUsd: z.number({ message: 'El monto es obligatorio.' }).positive('El monto debe ser mayor a 0.').max(1_000_000_000),
  /** Dato informativo (no entra en el cálculo del saldo). */
  tasa: z.number().positive('La tasa debe ser mayor a 0.').max(1_000_000_000).optional().nullable().transform(v => v ?? null),
  fecha: fechaNegocio,
  nota: textoOpcional(300),
  referencia: textoOpcional(60),
}).superRefine((d, ctx) => {
  if ((d.tipo === 'NC' || d.tipo === 'ND') && !d.nota) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nota'], message: 'La nota es obligatoria en una nota de crédito o de débito.' });
  }
});
export type CrearAsientoInput = z.infer<typeof crearAsientoSchema>;

export const anularAsientoSchema = z.object({
  motivo: z.string().trim().min(1, 'El motivo de la anulación es obligatorio.').max(300),
});
export type AnularAsientoInput = z.infer<typeof anularAsientoSchema>;

export const filtroEstadoCuentaSchema = z.object({
  desde: fechaNegocio.optional(),
  hasta: fechaNegocio.optional(),
});
