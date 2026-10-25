import type { Request, Response } from 'express';
import { obtenerSaldos } from '../services/saldos-service.js';
import type { TipoEntidad } from '../services/estado-cuenta-service.js';
import { logger } from '../utils/logger.js';

/**
 * Handler compartido de GET /api/proveedores/saldos y GET /api/clientes/saldos. El permiso
 * (proveedores:ver / clientes:ver, el mismo del estado de cuenta) lo pone cada router antes de este handler.
 * Sin cifras parciales: si el cálculo falla o vence, 503 con un mensaje genérico.
 */
export function responderSaldos(tipo: TipoEntidad) {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await obtenerSaldos(tipo));
    } catch (e) {
      logger.error({ evento: 'saldos.fallo_ruta', tipo, error: e instanceof Error ? e.message : String(e) });
      res.status(503).json({ error: 'No se pudieron calcular los saldos en este momento. Intenta de nuevo.' });
    }
  };
}
