import { Router } from 'express';
import { exigirCronSecret } from '../middlewares/exigir-cron-secret.js';
import { cronLimiter } from '../middlewares/rate-limit.js';
import { reprocesarAvisosPendientes } from '../services/avisos-pendientes-service.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * POST|GET /api/avisos/reprocesar — reintenta los avisos de Telegram/n8n que quedaron en la cola.
 * Lo llama el cron de Vercel (que usa GET) o a mano (POST). Sin sesión de usuario: protegida por
 * CRON_SECRET (Authorization: Bearer).
 *
 * LIMITACIÓN DEL PLAN HOBBY de Vercel: los crons solo pueden correr una vez al día (un schedule más
 * frecuente, p. ej. cada 15 min, hace FALLAR el deploy). Por eso vercel.json lo agenda a diario
 * (11:30 UTC). Para reintentar cada 15 min: (a) plan Pro y pasar el schedule a cada 15 minutos (minuto = paso de 15), o
 * (b) un Schedule Trigger de n8n que llame a este endpoint cada 15 min con
 * `Authorization: Bearer <CRON_SECRET>`.
 */
router.all('/reprocesar', cronLimiter, exigirCronSecret, async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }
  try {
    res.json({ resumen: await reprocesarAvisosPendientes() });
  } catch (err) {
    logger.error({ evento: 'avisos_reproceso_error', mensaje: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'No se pudo reprocesar la cola de avisos' });
  }
});

export default router;
