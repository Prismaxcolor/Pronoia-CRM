import { z } from 'zod';
import { TIPOS_MERMA } from '../utils/merma-tipificada.js';

/** Tope defensivo (kg) contra typos; coincide con el CHECK de la tabla (< 1.000.000). */
const MAX_MERMA_KG = 999_999;

/** Un renglón de merma por tipo. */
export const mermaRenglonSchema = z.object({
  tipo: z.enum(TIPOS_MERMA, { message: 'Tipo de merma inválido.' }),
  pesoKg: z.number().positive('La merma debe ser mayor a 0 kg.').max(MAX_MERMA_KG),
});

/** Desglose opcional de merma. Los tipos repetidos se suman en el servicio. */
export const mermaDetalleSchema = z.array(mermaRenglonSchema).max(20, 'Demasiados renglones de merma.');

/** PATCH /api/transformaciones/:id/merma — reemplaza el desglose ([] lo borra). */
export const editarMermaSchema = z.object({
  detalle: mermaDetalleSchema,
  llaveEdicion: z.string().trim().max(64).optional(),
});

export type MermaDetalleInput = z.infer<typeof mermaDetalleSchema>;
export type EditarMermaInput = z.infer<typeof editarMermaSchema>;
