import { z } from 'zod';

/** Valida que YYYY-MM-DD exista en el calendario (rechaza 2026-02-31, 2026-13-45). */
function esFechaReal(valor: string): boolean {
  const [anio, mes, dia] = valor.split('-').map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/** Tope defensivo (kg) contra typos como 1e9; ninguna pesada real se acerca. */
const MAX_PESO_KG = 10_000_000;

const pesoBruto = z.number().positive('El peso bruto debe ser mayor a 0.').max(MAX_PESO_KG);
const tara = z.number().min(0, 'La tara no puede ser negativa.').max(MAX_PESO_KG);

const salidaEditadaSchema = z
  .object({
    id: z.string().uuid('Id de salida inválido.'),
    pesoBruto: pesoBruto.optional(),
    tara: tara.optional(),
  })
  .refine(s => s.pesoBruto !== undefined || s.tara !== undefined, {
    message: 'Cada salida editada necesita peso bruto o tara.',
  });

/**
 * PATCH /api/transformaciones/:id/editar — fecha, notas y pesos (bruto/tara de
 * la entrada y de cada salida). El neto nunca se envía: es bruto - tara. Los
 * pesos recalculan stock, así que la BD valida todo en una sola transacción
 * (editar_transformacion_pesos). No se editan fotos, productos, lotes ni almacenes.
 */
export const editarTransformacionSchema = z
  .object({
    fecha: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).')
      .refine(esFechaReal, 'La fecha no existe en el calendario.')
      .optional(),
    notas: z.string().max(2000, 'Las notas no pueden superar 2000 caracteres.').optional(),
    pesoBruto: pesoBruto.optional(),
    tara: tara.optional(),
    salidas: z
      .array(salidaEditadaSchema)
      .max(200)
      .refine(l => new Set(l.map(s => s.id)).size === l.length, { message: 'Hay salidas repetidas en la edición.' })
      .optional(),
    llaveEdicion: z.string().trim().max(64).optional(),
  })
  .refine(
    d =>
      d.fecha !== undefined || d.notas !== undefined || d.pesoBruto !== undefined ||
      d.tara !== undefined || (d.salidas?.length ?? 0) > 0,
    { message: 'Indica al menos un campo a editar (fecha, notas o pesos).' }
  );

export type EditarTransformacionInput = z.infer<typeof editarTransformacionSchema>;
