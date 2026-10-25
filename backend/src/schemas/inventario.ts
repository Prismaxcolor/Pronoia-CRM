import { z } from 'zod';

/** almacenId se interpola en filtros PostgREST (.or): debe ser un UUID estricto. */
export const almacenIdSchema = z.string().uuid('Almacén inválido.');

/** Valida el almacenId de la query de inventario; undefined si no viene. */
export function parsearAlmacenId(valor: unknown): { ok: true; almacenId?: string } | { ok: false; error: string } {
  if (valor === undefined || valor === '') return { ok: true };
  const r = almacenIdSchema.safeParse(valor);
  return r.success ? { ok: true, almacenId: r.data } : { ok: false, error: 'Almacén inválido.' };
}
