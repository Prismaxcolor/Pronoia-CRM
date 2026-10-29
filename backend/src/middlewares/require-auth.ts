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
import { estadoUsuario } from '../utils/usuario-activo.js';
import { logger } from '../utils/logger.js';
import { contextoVisibilidadStaff } from '../services/proveedor-oculto.js';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      /** Permisos efectivos leídos de la BD por requirePermiso (no se llena para superadmin, que siempre pasa). */
      permisos?: Permiso[];
      /** Columna `permisos` que requireAuth acaba de leer de la BD en ESTA petición (fallo de caché): evita repetir la consulta. */
      permisosLeidosAhora?: { valor: unknown };
    }
  }
}

/** Valida el JWT y que el usuario siga activo en la BD (caché de 30 s), también el superadmin. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Falta token de autenticación.' });
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  let payload: JwtPayload;
  try {
    payload = verificarToken(token);
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado.' });
    return;
  }

  try {
    const estado = await estadoUsuario(payload.sub);
    if (!estado.activo) {
      res.status(401).json({ error: 'Usuario no encontrado o inactivo.' });
      return;
    }
    // El rol del JWT puede estar desactualizado (vive 7 días): manda el de la BD (caché de 30 s).
    if (estado.rol) payload = { ...payload, rol: estado.rol as JwtPayload['rol'] };
    if (estado.permisosFrescos !== undefined) req.permisosLeidosAhora = { valor: estado.permisosFrescos };
  } catch (e) {
    logger.error({ evento: 'auth_verificar_activo_fallido', error: e instanceof Error ? e.message : String(e) });
    res.status(503).json({ error: 'No se pudo verificar tu sesión. Intenta de nuevo.' });
    return;
  }

  req.user = payload;
  // Todo lo que corra después ve (o no) los proveedores ocultos según el rol: ver services/proveedor-oculto.ts.
  contextoVisibilidadStaff(req, res, next);
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
  return requireAlgunPermiso({ recurso, accion });
}

/**
 * Igual que requirePermiso pero basta con tener CUALQUIERA de los permisos dados. Sirve para
 * catálogos de solo lectura que otra pantalla necesita (p. ej. listar vehículos desde el pesaje
 * sin exigir el recurso 'vehiculos', ya que los permisos personalizados reemplazan a los del rol).
 */
export function requireAlgunPermiso(...requisitos: Permiso[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'No autenticado.' });
      return;
    }

    // El rol del JWT puede estar degradado en la BD: se confirma el rol real (caché de 30 s) antes de dar paso libre.
    let estado;
    try {
      estado = await estadoUsuario(req.user.sub);
    } catch {
      res.status(503).json({ error: 'No se pudo verificar tu sesión. Intenta de nuevo.' });
      return;
    }
    if (!estado.activo) {
      res.status(401).json({ error: 'Usuario no encontrado o inactivo.' });
      return;
    }
    if (estado.rol) req.user = { ...req.user, rol: estado.rol as JwtPayload['rol'] };

    if (req.user.rol === 'superadmin') {
      next();
      return;
    }

    // Si la lectura de estado de esta misma petición acaba de traer los permisos de la BD, se reutilizan
    // (misma frescura que una consulta nueva); si el estado vino de la caché, se consultan como siempre.
    const leidos = req.permisosLeidosAhora ?? (estado.permisosFrescos !== undefined ? { valor: estado.permisosFrescos } : null);
    let rol: RolUsuario;
    let personalizados: Permiso[] | null;
    if (leidos) {
      rol = estado.rol as RolUsuario;
      personalizados = leidos.valor as Permiso[] | null;
    } else {
      const { data, error } = await supabaseAdmin
        .from('users')
        .select('rol, permisos, activo')
        .eq('id', req.user.sub)
        .maybeSingle();

      if (error || !data || !data.activo) {
        res.status(401).json({ error: 'Usuario no encontrado o inactivo.' });
        return;
      }
      rol = data.rol as RolUsuario;
      personalizados = data.permisos as Permiso[] | null;
    }
    const permisos = permisosEfectivos(rol, personalizados);
    req.permisos = permisos;

    if (!requisitos.some(r => tienePermiso(permisos, r.recurso, r.accion))) {
      const faltan = requisitos.map(r => `${r.recurso}:${r.accion}`).join(' o ');
      res.status(403).json({ error: `Te falta el permiso ${faltan}.` });
      return;
    }

    next();
  };
}
