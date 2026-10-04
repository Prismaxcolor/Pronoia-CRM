import { z } from 'zod';

/** Tope defensivo (kg); coincide con el CHECK de lote_embalajes (< 10.000.000). */
const MAX_EMBALAJE_KG = 9_999_999;

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `No puede pasar de ${max} caracteres.`)
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null));

/** POST /api/lotes/:id/embalajes — marca N kg del lote como embalados/listos. */
export const marcarEmbalajeSchema = z.object({
  pesoKg: z.number({ message: 'Indica los kilos embalados.' }).positive('Los kilos deben ser mayores a 0.').max(MAX_EMBALAJE_KG),
  /** Almacén donde está lo embalado. Opcional: sin almacén se valida contra el stock total del lote. */
  almacenId: z.string().uuid('Almacén inválido.').nullish(),
  nota: textoOpcional(500),
  contenedor: textoOpcional(80),
});

/** POST /api/lotes/:id/embalajes/:embalajeId/anular */
export const anularEmbalajeSchema = z.object({
  motivo: z.string().trim().min(3, 'Indica el motivo de la anulación.').max(300, 'El motivo no puede pasar de 300 caracteres.'),
});

export type MarcarEmbalajeInput = z.infer<typeof marcarEmbalajeSchema>;
export type AnularEmbalajeInput = z.infer<typeof anularEmbalajeSchema>;
