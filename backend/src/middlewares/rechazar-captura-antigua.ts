import type { RequestHandler } from 'express';

/** El job de limpieza borra operaciones_cliente a los 30 días: pasado ese plazo un clientRequestId
 *  reenviado se volvería a ejecutar. Se rechaza antes con margen de 1 día. */
export const MAX_ANTIGUEDAD_CAPTURA_MS = 29 * 24 * 60 * 60 * 1000;

/** true si `capturadoEn` (ISO) es anterior a 29 días. Valores no parseables se dejan al esquema. */
export function capturaDemasiadoAntigua(capturadoEn: unknown, ahora: number = Date.now()): boolean {
  if (typeof capturadoEn !== 'string') return false;
  const t = Date.parse(capturadoEn);
  return Number.isFinite(t) && t < ahora - MAX_ANTIGUEDAD_CAPTURA_MS;
}

/** 409 si una operación de completar/editar con clientRequestId trae una captura de hace más de 29 días.
 *  Va ANTES de validateBody: el esquema recorta capturadoEn a ±24 h y perdería la fecha original. */
export const rechazarCapturaAntigua: RequestHandler = (req, res, next) => {
  const body = req.body as { clientRequestId?: unknown; capturadoEn?: unknown } | undefined;
  if (body?.clientRequestId && capturaDemasiadoAntigua(body.capturadoEn)) {
    res.status(409).json({
      error: 'Esta operación se capturó hace más de 29 días y ya no se puede reenviar. Vuelve a hacerla desde la pantalla.',
      reintentar: false,
    });
    return;
  }
  next();
};
