import { z } from 'zod';
import { ENTIDADES_AUDITABLES, ENTIDADES_CON_LLAVE } from '../utils/auditoria.js';

export const entidadTipoSchema = z.enum(ENTIDADES_AUDITABLES);

export const paramsAuditoriaSchema = z.object({
  entidadTipo: entidadTipoSchema,
  entidadId: z.string().uuid('Id de documento inválido.'),
});

export const crearLlaveSchema = z.object({
  entidadTipo: z.enum(ENTIDADES_CON_LLAVE),
  entidadId: z.string().uuid('Id de documento inválido.'),
});

/** Código tal como lo tipea el usuario (con o sin guion). */
export const codigoLlaveSchema = z.string().trim().min(6).max(32);

export type CrearLlaveInput = z.infer<typeof crearLlaveSchema>;
