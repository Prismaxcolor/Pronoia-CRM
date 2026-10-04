import { z } from 'zod';
import { CLASES_LOTE } from '../utils/lote-clasificacion.js';

/** Tope defensivo del precio estimado (USD/kg); coincide con el CHECK de lotes (< 1.000.000). */
const MAX_PRECIO_ESTIMADO_KG = 999_999;

export const crearLoteSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(80),
  fotos: z.array(z.string().url()).default([]),
});

export const actualizarLoteSchema = crearLoteSchema
  .extend({
    // Sin default: un PATCH que no menciona las fotos NO debe borrarlas (el default del crear las vaciaba).
    fotos: z.array(z.string().url()).optional(),
    activo: z.boolean().optional(),
    clase: z.enum(CLASES_LOTE, { message: 'Clase de lote inválida.' }).optional(),
    /** USD/kg aproximado de VENTA. null borra el precio; nunca se inventa uno. */
    precioEstimadoKg: z
      .number({ message: 'El precio debe ser un número.' })
      .min(0, 'El precio no puede ser negativo.')
      .max(MAX_PRECIO_ESTIMADO_KG)
      .nullable()
      .optional(),
  })
  .partial()
  .refine(data => Object.keys(data).length > 0, {
    message: 'Debes enviar al menos un campo a actualizar.',
  });

/** Ids de la URL: un id mal formado se rechaza con 400 antes de llegar a la BD (que daría un error 22P02). */
export const loteParamsSchema = z.object({
  id: z.string().uuid('El id del lote no es válido.'),
});

export const embalajeParamsSchema = loteParamsSchema.extend({
  embalajeId: z.string().uuid('El id del embalaje no es válido.'),
});

export type CrearLoteInput = z.infer<typeof crearLoteSchema>;
export type ActualizarLoteInput = z.infer<typeof actualizarLoteSchema>;
