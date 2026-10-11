import type { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { permisosEfectivos, type Permiso, type RolUsuario } from '../utils/permisos.js';

/**
 * Carga en `req.permisos` los permisos efectivos del usuario si aún no están (requirePermiso ya los carga; una
 * ruta con llave de edición, requirePermisoOLlave, puede saltárselo). Permite usar `reqTienePermiso` después.
 * No rechaza por falta de permisos: solo los carga. Si no se pueden leer responde 503 (falla cerrado).
 * El superadmin no los necesita (reqTienePermiso lo deja pasar). Va DESPUÉS de requireAuth.
 */
export async function cargarPermisosSiFaltan(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado.' });
    return;
  }
  if (req.permisos || req.user.rol === 'superadmin') {
    next();
    return;
  }
  const { data, error } = await supabaseAdmin.from('users').select('rol, permisos, activo').eq('id', req.user.sub).maybeSingle();
  if (error) {
    res.status(503).json({ error: 'No se pudo verificar tus permisos. Intenta de nuevo.' });
    return;
  }
  if (!data || !data.activo) {
    res.status(401).json({ error: 'Usuario no encontrado o inactivo.' });
    return;
  }
  req.permisos = permisosEfectivos(data.rol as RolUsuario, data.permisos as Permiso[] | null);
  next();
}
