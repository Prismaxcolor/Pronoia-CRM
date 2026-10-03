import { z } from 'zod';

export const crearLoteSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(80),
  fotos: z.array(z.string().url()).default([]),
});

export const actualizarLoteSchema = crearLoteSchema
  .extend({ activo: z.boolean().optional() })
  .partial()
  .refine(data => Object.keys(data).length > 0, {
    message: 'Debes enviar al menos un campo a actualizar.',
  });

export type CrearLoteInput = z.infer<typeof crearLoteSchema>;
export type ActualizarLoteInput = z.infer<typeof actualizarLoteSchema>;
