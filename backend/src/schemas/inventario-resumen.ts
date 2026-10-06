import { z } from 'zod';

/** Valida que YYYY-MM-DD exista en el calendario (rechaza 2026-02-31). */
function esFechaReal(valor: string): boolean {
  const [anio, mes, dia] = valor.split('-').map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

export const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).')
  .refine(esFechaReal, 'La fecha no existe en el calendario.');

/** Máximo de días del rango (~10 años): cubre el periodo "Todo" del cliente (desde 2020-01-01) con holgura. */
export const MAX_DIAS_RANGO = 3700;

/** `sinValor=1` pide la respuesta SIN costos ni precios aunque el usuario tenga facturacion:ver (solo puede quitar, nunca dar permisos). */
export const sinValorParam = z.enum(['1']).transform(() => true);

/** GET /api/inventario/resumen?desde=&hasta=&sinValor=1 — rango opcional (ambos o ninguno) para la merma. */
export const resumenQuerySchema = z
  .object({ desde: fecha.optional(), hasta: fecha.optional(), sinValor: sinValorParam.optional() })
  .refine(q => (q.desde == null) === (q.hasta == null), { message: 'Indica desde y hasta juntos, o ninguno.' })
  .refine(q => !q.desde || !q.hasta || q.desde <= q.hasta, { message: 'La fecha desde no puede ser posterior a hasta.' })
  .refine(
    q => !q.desde || !q.hasta || (Date.parse(q.hasta) - Date.parse(q.desde)) / 86_400_000 <= MAX_DIAS_RANGO,
    { message: `El rango no puede pasar de ${MAX_DIAS_RANGO} días.` }
  );

export type ResumenQuery = z.infer<typeof resumenQuerySchema>;
