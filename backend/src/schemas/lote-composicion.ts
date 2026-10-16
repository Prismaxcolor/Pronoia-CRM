import { z } from 'zod';
import { almacenIdSchema } from './inventario.js';
import { fecha, MAX_DIAS_RANGO } from './inventario-resumen.js';

export const loteIdSchema = z.string().uuid('Lote inválido.');

/**
 * Query de GET /api/inventario/pantalla/lotes/:loteId/composicion: desde/hasta (ambos o ninguno) y almacén.
 * Acepta almacenId (nombre del contrato) y almacen (nombre que usan los demás endpoints de la pantalla).
 */
export const composicionLoteQuerySchema = z
  .object({
    desde: fecha.optional(),
    hasta: fecha.optional(),
    almacenId: almacenIdSchema.optional(),
    almacen: almacenIdSchema.optional(),
  })
  .refine(q => (q.desde == null) === (q.hasta == null), { message: 'Indica desde y hasta juntos, o ninguno.' })
  .refine(q => !q.desde || !q.hasta || q.desde <= q.hasta, { message: 'La fecha desde no puede ser posterior a hasta.' })
  .refine(
    q => !q.desde || !q.hasta || (Date.parse(q.hasta) - Date.parse(q.desde)) / 86_400_000 <= MAX_DIAS_RANGO,
    { message: `El rango no puede pasar de ${MAX_DIAS_RANGO} días.` }
  )
  .transform(q => ({ desde: q.desde, hasta: q.hasta, almacenId: q.almacenId ?? q.almacen }));

export type ComposicionLoteQuery = z.infer<typeof composicionLoteQuerySchema>;
