import { z } from 'zod';

/** Una línea de material del traslado. El peso neto enviado lo calcula la BD.
 *  Cada línea lleva su propia foto — mismo criterio que el pesaje de compra/venta. */
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
    fotos: z.array(z.string()).min(1, 'Cada material necesita al menos una foto.'),
  })
  .refine(m => m.pesoBruto - m.tara >= 0, {
    message: 'El peso neto de un material no puede ser negativo.',
    path: ['pesoBruto'],
  });

/** Un lote (PCB) a trasladar completo — se pesa igual que un material, no se
 *  asume automáticamente su stock teórico. */
export const loteTrasladoSchema = z
  .object({
    loteId: z.string().uuid('Lote inválido.'),
    pesoBruto: z.number().nonnegative('El peso bruto no puede ser negativo.'),
    tara: z.number().nonnegative('La tara no puede ser negativa.'),
    fotos: z.array(z.string()).min(1, 'Cada lote necesita al menos una foto del pesaje.'),
  })
  .refine(l => l.pesoBruto - l.tara >= 0, {
    message: 'El peso neto de un lote no puede ser negativo.',
    path: ['pesoBruto'],
  });

export const crearTrasladoSchema = z
  .object({
    almacenOrigenId: z.string().uuid('Almacén de origen inválido.'),
    almacenDestinoId: z.string().uuid('Almacén de destino inválido.'),
    materiales: z.array(materialTrasladoSchema).default([]),
    /** Lotes (PCB) a trasladar completos — no una porción, el lote entero. */
    lotes: z.array(loteTrasladoSchema).default([]),
    /** Placa/identificador del vehículo que hace el traslado. */
    vehiculo: z
      .string()
      .trim()
      .max(80)
      .optional()
      .nullable()
      .transform(v => (v && v.length > 0 ? v : null)),
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
  })
  .refine(d => d.materiales.length + d.lotes.length >= 1, {
    message: 'Agrega al menos un material o lote a trasladar.',
    path: ['materiales'],
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
export type CrearTrasladoLoteInput = z.infer<typeof loteTrasladoSchema>;
export type CompletarTrasladoInput = z.infer<typeof completarTrasladoSchema>;
