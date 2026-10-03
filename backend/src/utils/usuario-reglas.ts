import type { RolUsuario } from './permisos.js';

export interface EdicionUsuarioContexto {
  actorId: string;
  targetId: string;
  target: { rol: RolUsuario; activo: boolean };
  cambios: { rol?: RolUsuario; activo?: boolean };
  /** Cantidad de superadmins activos en el sistema ANTES del cambio. */
  superadminsActivos: number;
}

export interface PrivilegiosEdicionContexto {
  /** Actor releído de la BD (el JWT dura 7 días y su rol puede estar viejo). null si no existe. */
  actor: { rol: RolUsuario; activo: boolean } | null;
  actorId: string;
  targetId: string;
  targetRol: RolUsuario;
  cambios: { rol?: RolUsuario; email?: string; password?: string };
}

export interface ErrorPrivilegios {
  error: string;
  status: 403;
}

const prohibido = (error: string): ErrorPrivilegios => ({ error, status: 403 });

/**
 * Evita la escalada de privilegios: quien tiene usuarios:editar pero no es
 * superadmin no puede tocar a un superadmin, ascender a nadie (ni a sí mismo)
 * a superadmin, ni cambiar correo o contraseña (credenciales de acceso).
 * Función pura: devuelve el error 403 o null si el cambio está permitido.
 */
export function validarPrivilegiosEdicion(ctx: PrivilegiosEdicionContexto): ErrorPrivilegios | null {
  const { actor, targetRol, cambios } = ctx;
  if (!actor || !actor.activo) return prohibido('Usuario no encontrado o inactivo.');
  if (actor.rol === 'superadmin') return null;

  if (targetRol === 'superadmin') {
    return prohibido('Solo un superadmin puede modificar a otro superadmin.');
  }
  if (cambios.rol === 'superadmin') {
    return prohibido('Solo un superadmin puede asignar el rol de superadmin.');
  }
  if (cambios.password !== undefined || cambios.email !== undefined) {
    return prohibido('Solo un superadmin puede cambiar el correo o la contraseña de un usuario.');
  }
  return null;
}

/**
 * Reglas de negocio de la edición de usuarios. Función pura: devuelve el
 * mensaje de error (en español) o null si el cambio es válido.
 */
export function validarEdicionUsuario(ctx: EdicionUsuarioContexto): string | null {
  const { actorId, targetId, target, cambios, superadminsActivos } = ctx;
  const esUnoMismo = actorId === targetId;

  if (esUnoMismo && cambios.activo === false) {
    return 'No puedes desactivarte a ti mismo.';
  }
  const dejaDeSerSuperadmin = target.rol === 'superadmin' && cambios.rol !== undefined && cambios.rol !== 'superadmin';
  if (esUnoMismo && dejaDeSerSuperadmin) {
    return 'No puedes quitarte a ti mismo el rol de superadmin.';
  }

  const desactiva = cambios.activo === false && target.activo;
  const eraSuperadminActivo = target.rol === 'superadmin' && target.activo;
  if (eraSuperadminActivo && (dejaDeSerSuperadmin || desactiva) && superadminsActivos <= 1) {
    return 'El sistema debe conservar al menos un superadmin activo.';
  }
  return null;
}
