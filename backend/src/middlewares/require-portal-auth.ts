import type { Request, Response, NextFunction } from 'express';
import { verificarSesionPortal, type PortalJwtPayload } from '../services/portal-auth-service.js';

declare global {
  namespace Express {
    interface Request {
      portalUser?: PortalJwtPayload;
    }
  }
}

/** Análogo a requireAuth pero para sesiones del portal de proveedores/clientes —
 *  usa un secreto de firma distinto (ver ENV.PORTAL_JWT_SECRET), nunca acepta un
 *  token de staff ni viceversa. */
export function requirePortalAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Falta iniciar sesión.' });
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  try {
    req.portalUser = verificarSesionPortal(token);
    next();
  } catch {
    res.status(401).json({ error: 'Sesión inválida o expirada.' });
  }
}
