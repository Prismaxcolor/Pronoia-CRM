import type { Request, Response, NextFunction } from 'express';
import { verificarToken, type JwtPayload } from '../services/auth-service.js';
import { supabaseAdmin } from '../config/supabase.js';
import {
  PERMISOS_POR_ROL,
  tienePermiso,
  type Permiso,
  type Recurso,
  type Accion,
  type RolUsuario,
} from '../utils/permisos.js';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Falta token de autenticación.' });
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  try {
    req.user = verificarToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado.' });
  }
}

export function requireRol(...roles: JwtPayload['rol'][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'No autenticado.' });
      return;
    }
    if (!roles.includes(req.user.rol)) {
      res.status(403).json({ error: 'No tienes permisos suficientes.' });
      return;
    }
    next();
  };
}

/**
 * Verifica que el usuario autenticado tenga el permiso (recurso, accion).
 * Lee permisos custom desde la BD para no quedar atado a snapshot del JWT
 * (los permisos pueden cambiar y el token vive 7 días).
 * Superadmin siempre pasa.
 */
export function requirePermiso(recurso: Recurso, accion: Accion) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'No autenticado.' });
      return;
    }

    if (req.user.rol === 'superadmin') {
      next();
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .select('rol, permisos, activo')
      .eq('id', req.user.sub)
      .maybeSingle();

    if (error || !data || !data.activo) {
      res.status(401).json({ error: 'Usuario no encontrado o inactivo.' });
      return;
    }

    const rol = data.rol as RolUsuario;
    const permisosCustom = data.permisos as Permiso[] | null;
    const permisos = permisosCustom && permisosCustom.length > 0
      ? permisosCustom
      : PERMISOS_POR_ROL[rol] ?? [];

    if (!tienePermiso(permisos, recurso, accion)) {
      res.status(403).json({ error: `Te falta el permiso ${recurso}:${accion}.` });
      return;
    }

    next();
  };
}
