import { z } from 'zod';
import { ENTIDADES_CON_LLAVE } from '../utils/auditoria.js';

export const crearSolicitudLlaveSchema = z.object({
  entidadTipo: z.enum(ENTIDADES_CON_LLAVE),
  entidadId: z.string().uuid('Id de documento inválido.'),
  motivo: z.string().trim().min(3, 'Cuéntanos el motivo (mínimo 3 caracteres).').max(300, 'El motivo admite hasta 300 caracteres.'),
});

export const rechazarSolicitudLlaveSchema = z.object({
  motivo: z.string().trim().min(3, 'El motivo debe tener al menos 3 caracteres.').max(300).optional(),
});

export const listarSolicitudesQuerySchema = z.object({
  estado: z.enum(['pendiente', 'aprobada', 'rechazada', 'usada', 'expirada']).default('pendiente'),
});

/** Lo que manda n8n cuando un superadmin toca un botón del aviso privado de Telegram. */
export const telegramCallbackSchema = z.object({
  telegramUserId: z.union([z.string().trim().min(1).max(32), z.number().int()]).transform(String),
  callbackData: z.string().trim().min(1).max(64),
  chatId: z.union([z.string().max(32), z.number().int()]).optional(),
  messageId: z.number().int().optional(),
});

export type CrearSolicitudLlaveInput = z.infer<typeof crearSolicitudLlaveSchema>;
