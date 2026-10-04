import { z } from 'zod';
import { almacenIdSchema } from './inventario.js';
import { fecha, MAX_DIAS_RANGO, sinValorParam } from './inventario-resumen.js';

/** Máximo de filas de la tabla de detalle por respuesta (el resto se avisa, no se pierde en silencio). */
export const MAX_FILAS_DETALLE = 2000;
export const FILAS_DETALLE_POR_DEFECTO = 500;

const textoCorto = z.string().trim().min(1).max(100);
const booleano = z.enum(['true', 'false']).transform(v => v === 'true');

/**
 * Filtros de GET /api/inventario/pantalla/{detalle,categorias,alertas}: desde/hasta (ambos o ninguno),
 * categoria, almacen (uuid), q. Solo el detalle usa limite, vista e incluirClasificaciones (los demás los ignoran).
 */
export const pantallaQuerySchema = z
  .object({
    desde: fecha.optional(),
    hasta: fecha.optional(),
    categoria: textoCorto.optional(),
    almacen: almacenIdSchema.optional(),
    q: textoCorto.optional(),
    limite: z.coerce.number().int().min(1).max(MAX_FILAS_DETALLE).optional(),
    vista: z.enum(['exportacion', 'venta_nacional', 'trabajo_interno', 'otras']).optional(),
    incluirClasificaciones: booleano.optional(),
    sinValor: sinValorParam.optional(),
  })
  .refine(q => (q.desde == null) === (q.hasta == null), { message: 'Indica desde y hasta juntos, o ninguno.' })
  .refine(q => !q.desde || !q.hasta || q.desde <= q.hasta, { message: 'La fecha desde no puede ser posterior a hasta.' })
  .refine(
    q => !q.desde || !q.hasta || (Date.parse(q.hasta) - Date.parse(q.desde)) / 86_400_000 <= MAX_DIAS_RANGO,
    { message: `El rango no puede pasar de ${MAX_DIAS_RANGO} días.` }
  );

export type PantallaQuery = z.infer<typeof pantallaQuerySchema>;
