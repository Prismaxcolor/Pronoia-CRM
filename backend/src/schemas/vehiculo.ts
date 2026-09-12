import { z } from 'zod';

export const crearVehiculoSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre/placa es obligatorio.').max(80),
});

export const actualizarVehiculoSchema = crearVehiculoSchema
  .extend({ activo: z.boolean().optional() })
  .partial()
  .refine(
    data => Object.keys(data).length > 0,
    { message: 'Debes enviar al menos un campo a actualizar.' }
  );

export type CrearVehiculoInput = z.infer<typeof crearVehiculoSchema>;
export type ActualizarVehiculoInput = z.infer<typeof actualizarVehiculoSchema>;
