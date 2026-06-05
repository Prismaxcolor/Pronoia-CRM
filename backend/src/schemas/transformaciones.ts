import { z } from 'zod';

export const crearTransformacionSchema = z
  .object({
    materialEntradaId: z.string().uuid('Material de entrada inválido.'),
    cantidadEntrada: z.number().positive('La cantidad de entrada debe ser mayor a 0.'),
    fecha: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).')
      .optional()
      .nullable()
      .transform(v => (v && v.length > 0 ? v : null)),
    notas: z.string().trim().max(500).optional().nullable().transform(v => (v && v.length > 0 ? v : null)),
    detalles: z
      .array(
        z.object({
          materialSalidaId: z.string().uuid('Material de salida inválido.'),
          cantidad: z.number().positive('La cantidad debe ser mayor a 0.'),
        })
      )
      .min(1, 'Agrega al menos un material de salida.'),
  })
  .refine(
    d => d.detalles.reduce((s, x) => s + x.cantidad, 0) <= d.cantidadEntrada + 1e-9,
    { message: 'La suma de las salidas no puede superar el material de entrada.', path: ['detalles'] }
  );

export type CrearTransformacionInput = z.infer<typeof crearTransformacionSchema>;
