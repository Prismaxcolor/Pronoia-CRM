import { z } from 'zod';

const descripcionOpcional = z
  .string()
  .trim()
  .max(300)
  .optional()
  .nullable()
  .transform(v => (v && v.length > 0 ? v : null));

export const crearTipoMaterialSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(80),
  descripcion: descripcionOpcional,
});

export const actualizarTipoMaterialSchema = crearTipoMaterialSchema
  .extend({ activo: z.boolean().optional() })
  .partial()
  .refine(
    data => Object.keys(data).length > 0,
    { message: 'Debes enviar al menos un campo a actualizar.' }
  );

export type CrearTipoMaterialInput = z.infer<typeof crearTipoMaterialSchema>;
export type ActualizarTipoMaterialInput = z.infer<typeof actualizarTipoMaterialSchema>;
