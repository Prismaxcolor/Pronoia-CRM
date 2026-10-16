import { z } from 'zod';
import { logger } from '../utils/logger.js';

/** Máxima diferencia tolerada entre la hora de captura del teléfono y la del servidor. */
export const MAX_DESFASE_CAPTURA_MS = 24 * 60 * 60 * 1000;

/** La hora del servidor (recibido_en) es la fuente de verdad: una captura a más de ±24 h de ahora
 *  (reloj del teléfono desfasado o manipulado) se recorta al límite y se registra. Devuelve ISO UTC. */
export function acotarCapturadoEn(iso: string, ahora: number = Date.now()): string {
  const t = Date.parse(iso);
  const minimo = ahora - MAX_DESFASE_CAPTURA_MS;
  const maximo = ahora + MAX_DESFASE_CAPTURA_MS;
  const acotado = Math.min(Math.max(t, minimo), maximo);
  if (acotado !== t) {
    logger.warn({ evento: 'capturado_en_fuera_de_rango', recibido: iso, usado: new Date(acotado).toISOString() });
  }
  return new Date(acotado).toISOString();
}

/** Campos opcionales que añade el cliente a una operación para el modo sin conexión.
 *  Sin `clientRequestId` la operación se comporta exactamente como antes. */
export const clienteOperacionCampos = {
  /** UUID generado en el dispositivo antes del primer intento: hace seguros los reintentos. */
  clientRequestId: z.string().uuid('Identificador de operación inválido.').optional(),
  /** Momento real en que se hizo la operación en el dispositivo (ISO 8601). */
  capturadoEn: z.string().datetime({ offset: true, message: 'Fecha de captura inválida.' })
    .transform(v => acotarCapturadoEn(v))
    .optional(),
};
