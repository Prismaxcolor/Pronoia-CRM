import { z } from 'zod';

const opcionalTrim = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null));

export const crearProveedorSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(120),
  rfc: opcionalTrim(40),
  telefono: opcionalTrim(40),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Email inválido.')
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null)),
});

export const actualizarProveedorSchema = crearProveedorSchema
  .extend({ activo: z.boolean().optional() })
  .partial()
  .refine(
    data => Object.keys(data).length > 0,
    { message: 'Debes enviar al menos un campo a actualizar.' }
  );

export type CrearProveedorInput = z.infer<typeof crearProveedorSchema>;
export type ActualizarProveedorInput = z.infer<typeof actualizarProveedorSchema>;
