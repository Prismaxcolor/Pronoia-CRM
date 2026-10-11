import { z } from 'zod';
import { esColorCategoriaValido, normalizarColorCategoria } from '../utils/categoria-wallet.js';

/** Color por omisión de una categoría nueva (gris de la paleta de bancas). */
export const COLOR_CATEGORIA_POR_DEFECTO = '#475569';

/** Máximo de días que abarca un reporte (acota las consultas). */
export const MAX_DIAS_REPORTE = 366;
const MAX_CATEGORIAS_REPORTE = 100;
const MS_POR_DIA = 86_400_000;

const colorSchema = z
  .string()
  .transform(normalizarColorCategoria)
  .refine(esColorCategoriaValido, 'Color inválido: usa el formato #RRGGBB.');

const nombreSchema = z.string().trim().min(1, 'El nombre es obligatorio.').max(80, 'El nombre es demasiado largo (máximo 80).');
const tipoSchema = z.enum(['INGRESO', 'EGRESO', 'AMBOS'], { message: 'Elige si la categoría es de ingresos, egresos o ambos.' });
const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD).');

export const crearCategoriaSchema = z.object({
  nombre: nombreSchema,
  tipo: tipoSchema,
  color: colorSchema.default(COLOR_CATEGORIA_POR_DEFECTO),
  /** Con valor, la nueva categoría es una subcategoría de esa categoría. */
  padreId: z.string().uuid('Categoría padre inválida.').nullable().optional().transform(v => v ?? null),
});

/** El padre no se cambia: para mover una subcategoría se crea otra y se archiva la anterior. */
export const actualizarCategoriaSchema = z
  .object({
    nombre: nombreSchema.optional(),
    tipo: tipoSchema.optional(),
    color: colorSchema.optional(),
    activo: z.boolean().optional(),
  })
  .refine(d => Object.values(d).some(v => v !== undefined), 'No hay nada que cambiar.');

/** `categoriaId: null` = dejar el movimiento sin categoría. La clave no se puede omitir. */
export const asignarCategoriaSchema = z.object({
  categoriaId: z.string().uuid('Categoría inválida.').nullable(),
});

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / MS_POR_DIA) + 1;
}

/** Valida el orden y el largo máximo del rango de un reporte. */
function validarRango(d: { desde: string; hasta: string }, ctx: z.RefinementCtx): void {
  if (d.desde > d.hasta) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['desde'], message: 'La fecha "desde" no puede ser posterior a "hasta".' });
  } else if (diasEntre(d.desde, d.hasta) > MAX_DIAS_REPORTE) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hasta'], message: `El reporte puede abarcar como máximo ${MAX_DIAS_REPORTE} días.` });
  }
}

export const filtroReporteCuentaSchema = z
  .object({ bancaId: z.string().uuid('Cuenta inválida.'), desde: fechaSchema, hasta: fechaSchema })
  .superRefine(validarRango);

const listaUuids = z
  .string()
  .optional()
  .transform(v => (v ? v.split(',').map(x => x.trim()).filter(Boolean) : []))
  .pipe(z.array(z.string().uuid('Categoría inválida.')).max(MAX_CATEGORIAS_REPORTE, 'Demasiadas categorías.'));

export const filtroReporteCategoriasSchema = z
  .object({
    categorias: listaUuids,
    desde: fechaSchema,
    hasta: fechaSchema,
    sinCategoria: z.enum(['true', 'false']).optional().transform(v => v === 'true'),
  })
  .superRefine(validarRango);

export type CrearCategoriaInput = z.infer<typeof crearCategoriaSchema>;
export type ActualizarCategoriaInput = z.infer<typeof actualizarCategoriaSchema>;
export type FiltroReporteCuenta = z.infer<typeof filtroReporteCuentaSchema>;
export type FiltroReporteCategorias = z.infer<typeof filtroReporteCategoriasSchema>;
