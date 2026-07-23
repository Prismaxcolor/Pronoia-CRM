import type { Request, Response, NextFunction } from 'express';
import { verificarSesionPortal, PORTAL_COOKIE_NAME, type PortalJwtPayload } from '../services/portal-auth-service.js';

declare global {
  namespace Express {
    interface Request {
      portalUser?: PortalJwtPayload;
    }
  }
}

/** Análogo a requireAuth pero para sesiones del portal de proveedores/clientes —
 *  usa un secreto de firma distinto (ver ENV.PORTAL_JWT_SECRET) y viaja en una
 *  cookie httpOnly (no en Authorization header como el staff), para que un XSS
 *  en el portal no pueda robar el token vía JS. */
export function requirePortalAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[PORTAL_COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: 'Falta iniciar sesión.' });
    return;
  }

  try {
    req.portalUser = verificarSesionPortal(token);
    next();
  } catch {
    res.status(401).json({ error: 'Sesión inválida o expirada.' });
  }
}
