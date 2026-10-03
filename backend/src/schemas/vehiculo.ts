import { z } from 'zod';

const MAX_DESCRIPCION = 200;

export const crearVehiculoSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre/placa es obligatorio.').max(80),
  /** Tipo o descripción libre (ej. "Camión 350", "Rastra"). Opcional. */
  descripcion: z
    .string()
    .trim()
    .max(MAX_DESCRIPCION)
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null)),
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
