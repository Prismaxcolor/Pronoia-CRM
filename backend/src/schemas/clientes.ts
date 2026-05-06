import { z } from 'zod';

const opcionalTrim = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null));

export const crearClienteSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(120),
  identificacion: opcionalTrim(40),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Email inválido.')
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null)),
  telefono: opcionalTrim(40),
  direccion: opcionalTrim(300),
  notas: opcionalTrim(500),
});

export const actualizarClienteSchema = crearClienteSchema
  .extend({ activo: z.boolean().optional() })
  .partial()
  .refine(
    data => Object.keys(data).length > 0,
    { message: 'Debes enviar al menos un campo a actualizar.' }
  );

export type CrearClienteInput = z.infer<typeof crearClienteSchema>;
export type ActualizarClienteInput = z.infer<typeof actualizarClienteSchema>;
