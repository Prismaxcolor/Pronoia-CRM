import { z } from 'zod';

const fechaIso = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (formato YYYY-MM-DD).')
  .optional()
  .nullable()
  .transform(v => (v && v.length > 0 ? v : null));

export const crearListaSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(120),
  vigenteDesde: fechaIso,
});

export const actualizarListaSchema = crearListaSchema
  .extend({ activo: z.boolean().optional() })
  .partial()
  .refine(
    data => Object.keys(data).length > 0,
    { message: 'Debes enviar al menos un campo a actualizar.' }
  );

/** Upsert de un precio (material) dentro de una lista. */
export const upsertPrecioSchema = z.object({
  productoId: z.string().uuid('productoId inválido.'),
  precio: z.number().positive('El precio debe ser mayor a 0.'),
});

export type CrearListaInput = z.infer<typeof crearListaSchema>;
export type ActualizarListaInput = z.infer<typeof actualizarListaSchema>;
export type UpsertPrecioInput = z.infer<typeof upsertPrecioSchema>;
