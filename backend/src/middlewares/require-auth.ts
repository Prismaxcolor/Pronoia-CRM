import type { Request, Response, NextFunction } from 'express';
import { verificarToken, type JwtPayload } from '../services/auth-service.js';
import { supabaseAdmin } from '../config/supabase.js';
import {
  permisosEfectivos,
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
      /** Permisos efectivos leídos de la BD por requirePermiso (no se llena para superadmin, que siempre pasa). */
      permisos?: Permiso[];
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

/**
 * Solo superadmin: el nivel más alto que existe en el sistema. Se usa para cambiar parámetros que
 * afectan lo que ve todo el equipo (meta de contenedor, umbrales, clase y precio estimado de lotes).
 */
export function requireSuperadmin(mensaje = 'Solo un superadmin puede hacer este cambio.') {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'No autenticado.' });
      return;
    }
    if (req.user.rol !== 'superadmin') {
      res.status(403).json({ error: mensaje });
      return;
    }
    next();
  };
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
 * ¿El usuario de esta petición tiene (recurso, accion)? Misma regla que requirePermiso: el superadmin
 * siempre sí; el resto según los permisos efectivos que requirePermiso ya leyó de la BD. Si esos
 * permisos no se cargaron (la ruta no pasó por requirePermiso) responde false: falla cerrado.
 */
export function reqTienePermiso(req: Request, recurso: Recurso, accion: Accion): boolean {
  if (!req.user) return false;
  if (req.user.rol === 'superadmin') return true;
  return tienePermiso(req.permisos ?? [], recurso, accion);
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
    const permisos = permisosEfectivos(rol, data.permisos as Permiso[] | null);
    req.permisos = permisos;

    if (!tienePermiso(permisos, recurso, accion)) {
      res.status(403).json({ error: `Te falta el permiso ${recurso}:${accion}.` });
      return;
    }

    next();
  };
}
