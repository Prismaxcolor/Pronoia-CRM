import { z } from 'zod';

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null));

export const crearBancaSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(100),
  tipo: z.enum(['banco_nacional', 'banco_internacional', 'exchange', 'efectivo']),
  moneda: z.string().trim().min(1, 'La moneda es obligatoria.').max(10),
  descripcion: textoOpcional(200),
});

export const actualizarBancaSchema = z.object({
  nombre: z.string().trim().min(1).max(100).optional(),
  tipo: z.enum(['banco_nacional', 'banco_internacional', 'exchange', 'efectivo']).optional(),
  descripcion: textoOpcional(200),
});

export const crearMovimientoSchema = z.object({
  tipo: z.enum(['ingreso', 'egreso']),
  bancaId: z.string().uuid('Selecciona una banca.'),
  monto: z.number().positive('El monto debe ser mayor a 0.'),
  moneda: z.string().trim().min(1).max(10),
  descripcion: textoOpcional(200),
  referencia: textoOpcional(50),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).'),
  proveedorId: z.string().uuid('Proveedor inválido.').optional().nullable(),
  clienteId: z.string().uuid('Cliente inválido.').optional().nullable(),
});

export type CrearBancaInput = z.infer<typeof crearBancaSchema>;
export type ActualizarBancaInput = z.infer<typeof actualizarBancaSchema>;
export type CrearMovimientoInput = z.infer<typeof crearMovimientoSchema>;
