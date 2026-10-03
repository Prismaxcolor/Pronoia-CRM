import { z } from 'zod';

/** Tope defensivo (kg) contra typos como 1e9. */
const MAX_PESO_KG = 10_000_000;

const lineaEditadaSchema = z
  .object({
    id: z.string().uuid('Id de línea inválido.'),
    pesoBruto: z.number().positive('El peso bruto debe ser mayor a 0.').max(MAX_PESO_KG).optional(),
    tara: z.number().min(0, 'La tara no puede ser negativa.').max(MAX_PESO_KG).optional(),
    pesoRecibido: z.number().min(0, 'El peso recibido no puede ser negativo.').max(MAX_PESO_KG).optional(),
  })
  .refine(l => l.pesoBruto !== undefined || l.tara !== undefined || l.pesoRecibido !== undefined, {
    message: 'Cada línea editada necesita peso bruto, tara o peso recibido.',
  });

/**
 * PATCH /api/traslados/:id/editar — observaciones y pesos de cada línea (bruto,
 * tara y, si ya fue recepcionado, peso recibido). El neto nunca se envía. Los
 * pesos recalculan stock en origen y destino: la BD valida todo en una sola
 * transacción (editar_traslado_pesos). Fotos, materiales, lotes y almacenes no se editan.
 */
export const editarTrasladoSchema = z
  .object({
    observaciones: z.string().max(2000, 'Las observaciones no pueden superar 2000 caracteres.').optional(),
    lineas: z
      .array(lineaEditadaSchema)
      .max(200)
      .refine(l => new Set(l.map(x => x.id)).size === l.length, { message: 'Hay líneas repetidas en la edición.' })
      .optional(),
    llaveEdicion: z.string().trim().max(64).optional(),
  })
  .refine(d => d.observaciones !== undefined || (d.lineas?.length ?? 0) > 0, {
    message: 'Indica al menos un campo a editar (observaciones o pesos).',
  });

export type EditarTrasladoInput = z.infer<typeof editarTrasladoSchema>;
