import { z } from 'zod';

export const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const crearCitaSchema = z.object({
  fecha: z.string().regex(FECHA_RE, 'Fecha inválida (formato YYYY-MM-DD).'),
  hora: z.string().regex(HORA_RE, 'Hora inválida (formato HH:mm).'),
  notas: z.string().trim().max(500).optional(),
});
export type CrearCitaInput = z.infer<typeof crearCitaSchema>;

export const actualizarEstadoCitaSchema = z.object({
  estado: z.enum(['pendiente', 'confirmada', 'reprogramada', 'cancelada', 'completada']),
});
export type ActualizarEstadoCitaInput = z.infer<typeof actualizarEstadoCitaSchema>;
