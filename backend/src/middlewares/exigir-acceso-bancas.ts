import type { Request, Response, NextFunction } from 'express';
import { accesoBancas } from '../services/banca-acceso-service.js';
import { idsBancasDeBody, mensajeDeEscritura } from '../utils/banca-acceso.js';
import { logger } from '../utils/logger.js';

export const MENSAJE_ACCESO_NO_VERIFICABLE = 'No se pudo verificar tu acceso a la cuenta. Inténtalo de nuevo.';

/**
 * Responde 403 si la petición escribe sobre una cuenta/caja a la que el usuario no tiene acceso o sobre la
 * que solo tiene acceso de consulta (usuarios_bancas.puede_editar = false). Todas las rutas que lo usan
 * registran, modifican o anulan dinero, por eso exige permiso de edición y no solo de vista.
 * Revisa las bancas del body y, si se pasa `bancasActuales` (en una edición/anulación), también
 * las que el registro tiene hoy. Si esa consulta falla responde 503 (falla cerrado: nunca next()).
 * Un registro inexistente devuelve [] y se deja pasar para que el handler responda 404.
 * Va DESPUÉS de requireAuth/validateBody. Superadmin pasa siempre.
 */
export function exigirAccesoBancas(bancasActuales?: (req: Request) => Promise<string[]>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'No autenticado.' });
      return;
    }
    const acceso = await accesoBancas(req.user.sub, req.user.rol);
    if (acceso.ver === null && acceso.editar === null) {
      next();
      return;
    }
    let actuales: string[] = [];
    if (bancasActuales) {
      try {
        actuales = await bancasActuales(req);
      } catch (e) {
        logger.error({ evento: 'banca_acceso_registro_no_verificable', userId: req.user.sub, mensaje: e instanceof Error ? e.message : String(e) });
        res.status(503).json({ error: MENSAJE_ACCESO_NO_VERIFICABLE });
        return;
      }
    }
    const rechazo = mensajeDeEscritura(acceso, [...idsBancasDeBody(req.body), ...actuales]);
    if (rechazo) {
      res.status(403).json({ error: rechazo });
      return;
    }
    next();
  };
}
