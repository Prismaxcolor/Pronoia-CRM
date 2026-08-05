import { z } from 'zod';

/** Una línea de material del traslado. El peso neto enviado lo calcula la BD. */
export const materialTrasladoSchema = z
  .object({
    productoId: z.string().uuid('Material inválido.'),
    subcategoria: z
      .string()
      .trim()
      .max(120)
      .optional()
      .nullable()
      .transform(v => (v && v.length > 0 ? v : null)),
    pesoBruto: z.number().nonnegative('El peso bruto no puede ser negativo.'),
    tara: z.number().nonnegative('La tara no puede ser negativa.'),
  })
  .refine(m => m.pesoBruto - m.tara >= 0, {
    message: 'El peso neto de un material no puede ser negativo.',
    path: ['pesoBruto'],
  });

export const crearTrasladoSchema = z
  .object({
    almacenOrigenId: z.string().uuid('Almacén de origen inválido.'),
    almacenDestinoId: z.string().uuid('Almacén de destino inválido.'),
    materiales: z.array(materialTrasladoSchema).min(1, 'Agrega al menos un material.'),
    observaciones: z
      .string()
      .trim()
      .max(500)
      .optional()
      .nullable()
      .transform(v => (v && v.length > 0 ? v : null)),
  })
  .refine(d => d.almacenOrigenId !== d.almacenDestinoId, {
    message: 'El almacén de origen y destino no pueden ser el mismo.',
    path: ['almacenDestinoId'],
  });

/** Recepción de un traslado pendiente: cuánto llegó realmente por línea de
 *  material (puede diferir de lo enviado) + evidencia fotográfica obligatoria. */
export const completarTrasladoSchema = z.object({
  recepciones: z
    .array(
      z.object({
        detalleId: z.string().uuid('Línea de material inválida.'),
        pesoRecibido: z.number().nonnegative('El peso recibido no puede ser negativo.'),
      })
    )
    .min(1, 'Registra lo recibido de al menos un material.'),
  fotos: z.array(z.string()).min(1, 'La recepción requiere al menos una foto de evidencia.'),
});

export type CrearTrasladoInput = z.infer<typeof crearTrasladoSchema>;
export type CrearTrasladoMaterialInput = z.infer<typeof materialTrasladoSchema>;
export type CompletarTrasladoInput = z.infer<typeof completarTrasladoSchema>;
