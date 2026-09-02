import { z } from 'zod';

const composicionItemSchema = z.object({
  item: z.string().trim().min(1).max(60),
  porcentaje: z.number().min(0).max(100),
});

export const crearLoteSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(80),
  almacenId: z.string().uuid('Elige un almacén.'),
  fotos: z.array(z.string().url()).default([]),
  composicion: z.array(composicionItemSchema).default([]),
});

export const actualizarLoteSchema = crearLoteSchema
  .extend({ activo: z.boolean().optional() })
  .partial()
  .refine(data => Object.keys(data).length > 0, {
    message: 'Debes enviar al menos un campo a actualizar.',
  });

export type CrearLoteInput = z.infer<typeof crearLoteSchema>;
export type ActualizarLoteInput = z.infer<typeof actualizarLoteSchema>;
