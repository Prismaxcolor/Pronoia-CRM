import type { Request, Response, NextFunction } from 'express';
import { verificarSesionPortal, PORTAL_COOKIE_NAME, type PortalJwtPayload } from '../services/portal-auth-service.js';
import { conVisibilidadProveedores, proveedorVisible } from '../services/proveedor-oculto.js';

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
 *  en el portal no pueda robar el token vía JS.
 *  El portal nunca ve proveedores ocultos: una sesión de un proveedor que el superadmin
 *  ocultó después de iniciarla deja de valer. */
export function requirePortalAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[PORTAL_COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: 'Falta iniciar sesión.' });
    return;
  }

  try {
    req.portalUser = verificarSesionPortal(token);
  } catch {
    res.status(401).json({ error: 'Sesión inválida o expirada.' });
    return;
  }

  const { entidadTipo, entidadId } = req.portalUser;
  conVisibilidadProveedores(true, () => {
    void (async () => {
      try {
        if (entidadTipo === 'proveedor' && !(await proveedorVisible(entidadId))) {
          res.status(401).json({ error: 'Sesión inválida o expirada.' });
          return;
        }
        next();
      } catch {
        res.status(503).json({ error: 'No se pudo verificar tu sesión. Intenta de nuevo.' });
      }
    })();
  });
}
