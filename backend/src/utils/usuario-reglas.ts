import { permisosEfectivos, tienePermiso, type Permiso, type RolUsuario } from './permisos.js';
import type { TemaMarca } from './tema-marca.js';

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
  cambios: { rol?: RolUsuario; email?: string; password?: string; temaMarca?: TemaMarca | null; permisos?: Permiso[] };
  /** Permisos personalizados del actor (columna `permisos`); null/ausente = los de su rol. */
  actorPermisos?: Permiso[] | null;
  /** Permisos personalizados actuales del usuario editado (columna `permisos`); null/ausente = los de su rol. */
  targetPermisos?: Permiso[] | null;
}

/** Recursos tan sensibles que solo un superadmin puede conceder permisos sobre ellos (datos personales y cuentas). */
export const RECURSOS_SOLO_SUPERADMIN: readonly string[] = ['nomina', 'usuarios'];

export interface ErrorPrivilegios {
  error: string;
  status: 403;
}

const prohibido = (error: string): ErrorPrivilegios => ({ error, status: 403 });

/** Permisos que quedarían concedidos y que el usuario no tenía (en efectivo) antes del cambio. */
function permisosConcedidos(ctx: PrivilegiosEdicionContexto): Permiso[] {
  const { cambios, targetRol, targetPermisos } = ctx;
  if (cambios.permisos === undefined && (cambios.rol === undefined || cambios.rol === targetRol)) return [];
  const actuales = permisosEfectivos(targetRol, targetPermisos);
  // Misma regla que requirePermiso: los personalizados (si hay alguno) reemplazan a los del rol; una lista vacía = los del rol.
  const resultantes = permisosEfectivos(cambios.rol ?? targetRol, cambios.permisos ?? targetPermisos);
  return resultantes.filter(p => !tienePermiso(actuales, p.recurso, p.accion));
}

/** Error si un no superadmin intenta conceder permisos de nómina/usuarios o que él mismo no posee; null si puede. */
function validarConcesion(concedidos: readonly Permiso[], permisosActor: readonly Permiso[]): ErrorPrivilegios | null {
  if (concedidos.some(p => RECURSOS_SOLO_SUPERADMIN.includes(p.recurso))) {
    return prohibido('Solo un superadmin puede conceder permisos de nómina o de usuarios.');
  }
  if (concedidos.some(p => !tienePermiso([...permisosActor], p.recurso, p.accion))) {
    return prohibido('No puedes conceder permisos que tú no tienes.');
  }
  return null;
}

/**
 * Evita la escalada de privilegios: quien tiene usuarios:editar pero no es
 * superadmin no puede tocar a un superadmin, ascender a nadie (ni a sí mismo)
 * a superadmin, ni cambiar correo o contraseña (credenciales de acceso). Tampoco
 * puede conceder (a sí mismo ni a otros, por permisos o por cambio de rol) permisos
 * que él no posee, y los de nómina y usuarios solo los concede un superadmin.
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
  if (cambios.temaMarca !== undefined) {
    return prohibido('Solo un superadmin puede cambiar el color del sistema de un usuario.');
  }
  return validarConcesion(permisosConcedidos(ctx), permisosEfectivos(actor.rol, ctx.actorPermisos));
}

export interface PrivilegiosCreacionContexto {
  actor: { rol: RolUsuario; activo: boolean } | null;
  actorPermisos?: Permiso[] | null;
  /** Rol con el que se crea el usuario nuevo (sin permisos personalizados: tendrá los del rol). */
  rol: RolUsuario;
}

/** Crear un usuario también concede permisos (los de su rol): un no superadmin no puede crear superadmins ni dar más de lo que tiene. */
export function validarPrivilegiosCreacion(ctx: PrivilegiosCreacionContexto): ErrorPrivilegios | null {
  const { actor, rol } = ctx;
  if (!actor || !actor.activo) return prohibido('Usuario no encontrado o inactivo.');
  if (actor.rol === 'superadmin') return null;
  if (rol === 'superadmin') return prohibido('Solo un superadmin puede asignar el rol de superadmin.');
  return validarConcesion(permisosEfectivos(rol, null), permisosEfectivos(actor.rol, ctx.actorPermisos));
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
