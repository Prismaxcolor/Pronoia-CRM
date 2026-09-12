import { z } from 'zod';

export const crearTaraSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(80),
  peso: z.number().positive('El peso debe ser mayor a 0.'),
  // .optional() en vez de .default([]) a propósito: ver nota en clientes.ts —
  // con default, este schema (usado por actualizarTaraSchema.partial())
  // dejaría "fotos" siempre presente y borraría fotos existentes en PATCH.
  fotos: z.array(z.string().url('URL de foto inválida.')).optional(),
});

export const actualizarTaraSchema = crearTaraSchema
  .extend({ activo: z.boolean().optional() })
  .partial()
  .refine(
    data => Object.keys(data).length > 0,
    { message: 'Debes enviar al menos un campo a actualizar.' }
  );

export type CrearTaraInput = z.infer<typeof crearTaraSchema>;
export type ActualizarTaraInput = z.infer<typeof actualizarTaraSchema>;
