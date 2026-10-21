import type { Request, Response, NextFunction } from 'express';
import { requirePermiso } from './require-auth.js';
import type { Accion, Recurso } from '../utils/permisos.js';
import { presentaLlave } from '../utils/llave-en-peticion.js';
import { llaveEdicionActiva } from '../utils/llave-edicion.js';

/**
 * Para rutas de edición protegidas por llave. Quien presenta una llave no
 * necesita el permiso 'editar' del rol: la llave la entrega el superadmin para
 * ESE documento y el servicio la valida (documento, vigencia, un solo uso y
 * usuario activo). Sin llave se exige el permiso de siempre.
 */
export function requirePermisoOLlave(recurso: Recurso, accion: Accion) {
  const porPermiso = requirePermiso(recurso, accion);
  return async (req: Request, res: Response, next: NextFunction) => {
    // La llave solo sustituye al permiso cuando el sistema de llaves está activo.
    // Con REQUIRE_EDIT_KEY=false el servicio no la valida, así que se ignora.
    if (req.user && llaveEdicionActiva() && presentaLlave(req.body)) {
      next();
      return;
    }
    await porPermiso(req, res, next);
  };
}
