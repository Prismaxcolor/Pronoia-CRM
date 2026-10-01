import { z } from 'zod';

/** Valida que YYYY-MM-DD exista en el calendario (rechaza 2026-02-31, 2026-13-45). */
function esFechaReal(valor: string): boolean {
  const [anio, mes, dia] = valor.split('-').map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/** PATCH /api/transformaciones/:id/editar — solo fecha y notas (no pesos ni salidas: afectan stock). */
export const editarTransformacionSchema = z
  .object({
    fecha: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).')
      .refine(esFechaReal, 'La fecha no existe en el calendario.')
      .optional(),
    notas: z.string().max(2000, 'Las notas no pueden superar 2000 caracteres.').optional(),
    llaveEdicion: z.string().trim().max(64).optional(),
  })
  .refine(d => d.fecha !== undefined || d.notas !== undefined, {
    message: 'Indica al menos un campo a editar (fecha o notas).',
  });

export type EditarTransformacionInput = z.infer<typeof editarTransformacionSchema>;
