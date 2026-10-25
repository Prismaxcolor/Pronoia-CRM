import { timingSafeEqual, createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { obtenerSecreto } from '../config/secretos.js';
import { logger } from '../utils/logger.js';

const PREFIJO_BEARER = 'Bearer ';

/** Compara en tiempo constante (se hashea para igualar longitudes). */
function secretosIguales(recibido: string, esperado: string): boolean {
  const a = createHash('sha256').update(recibido).digest();
  const b = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(a, b);
}

/** Protege rutas de cron sin sesión de usuario con `Authorization: Bearer $CRON_SECRET`
 *  (estándar de Vercel Cron). Falla cerrado: sin CRON_SECRET configurado responde 503. */
export async function exigirCronSecret(req: Request, res: Response, next: NextFunction): Promise<void> {
  const secreto = await obtenerSecreto('CRON_SECRET');
  if (!secreto) {
    logger.warn({ evento: 'cron_sin_secreto', ruta: req.path });
    res.status(503).json({ error: 'Tarea programada no configurada' });
    return;
  }
  const cabecera = req.headers.authorization ?? '';
  const recibido = cabecera.startsWith(PREFIJO_BEARER) ? cabecera.slice(PREFIJO_BEARER.length).trim() : '';
  if (!recibido || !secretosIguales(recibido, secreto)) {
    logger.warn({ evento: 'cron_secreto_invalido', ruta: req.path });
    res.status(401).json({ error: 'No autorizado' });
    return;
  }
  next();
}
