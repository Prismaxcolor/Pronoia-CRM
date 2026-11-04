import { z } from 'zod';

const precio = z.number().min(0, 'El precio no puede ser negativo.').max(1_000_000).nullable();

/** PATCH /api/transformaciones/:id/valoracion.
 *  Semántica: campo ausente = sin cambios; null = borrar el valor.
 *  En `salidas` solo se tocan las listadas (su precioUnitario es obligatorio; null = borrar). */
export const guardarValoracionSchema = z.object({
  facturaCompraId: z.string().uuid().nullable().optional(),
  costoUnitario: precio.optional(),
  salidas: z
    .array(z.object({ id: z.string().uuid(), precioUnitario: precio }))
    .max(100)
    .default([]),
});

export type GuardarValoracionInput = z.infer<typeof guardarValoracionSchema>;
