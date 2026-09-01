import { z } from 'zod';

export const crearAlmacenSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(80),
  detalle: z.string().trim().max(500).nullable().optional(),
  fotos: z.array(z.string().url()).default([]),
});

export const actualizarAlmacenSchema = crearAlmacenSchema
  .extend({ activo: z.boolean().optional() })
  .partial()
  .refine(
    data => Object.keys(data).length > 0,
    { message: 'Debes enviar al menos un campo a actualizar.' }
  );

export type CrearAlmacenInput = z.infer<typeof crearAlmacenSchema>;
export type ActualizarAlmacenInput = z.infer<typeof actualizarAlmacenSchema>;
