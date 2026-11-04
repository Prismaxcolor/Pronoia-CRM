import { supabaseAdmin } from '../config/supabase.js';
import { consumirLlave, liberarLlave } from './llave-edicion-service.js';
import {
  edicionRequiereLlave,
  esSuperadminVigente,
  llaveEdicionActiva,
  type UsuarioVigente,
} from '../utils/llave-edicion.js';
import type { EntidadConLlave } from '../utils/auditoria.js';
import type { RolUsuario } from '../utils/permisos.js';
import { logger } from '../utils/logger.js';

/** Quién ejecuta la edición y, si aplica, la llave que presenta. */
export interface ActorEdicion {
  userId: string;
  email?: string;
  /** Rol del JWT: solo informativo. La decisión usa el rol releído de la BD. */
  rol: RolUsuario;
  llave?: string;
}

export type AutorizacionEdicion =
  | { ok: true; autorizadoPor: string | null; liberar: () => Promise<void> }
  | { ok: false; error: string; codigo: number };

const SIN_LIBERAR = async (): Promise<void> => {};

/** Lee rol y estado ACTUALES del usuario (como requirePermiso). null si no existe o la BD falla. */
export async function obtenerUsuarioVigente(userId: string): Promise<UsuarioVigente | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('rol, activo')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return { rol: data.rol as RolUsuario, activo: Boolean(data.activo) };
}

/** True si el usuario es superadmin activo según la BD. */
export async function esSuperadminEnBd(userId: string): Promise<boolean> {
  return esSuperadminVigente(await obtenerUsuarioVigente(userId));
}

/**
 * Decide si el actor puede editar el documento. La llave está activa por defecto;
 * solo con REQUIRE_EDIT_KEY=false pasa sin tocar la BD. Con la llave activa se
 * relee el usuario en la BD: un inactivo se rechaza y el rol vigente (no el del JWT) decide si
 * necesita llave. Quien la necesita debe presentar una llave vigente, de un
 * solo uso y ligada a este documento; se consume aquí y `liberar` la devuelve
 * si la edición falla.
 */
export async function autorizarEdicion(
  actor: ActorEdicion,
  entidadTipo: EntidadConLlave,
  entidadId: string
): Promise<AutorizacionEdicion> {
  if (!llaveEdicionActiva()) {
    return { ok: true, autorizadoPor: null, liberar: SIN_LIBERAR };
  }

  const vigente = await obtenerUsuarioVigente(actor.userId);
  if (!vigente || !vigente.activo) {
    logger.warn({ evento: 'edicion_rechazada_usuario_inactivo', userId: actor.userId, entidadTipo, entidadId });
    return { ok: false, codigo: 403, error: 'Usuario no encontrado o inactivo.' };
  }
  if (!edicionRequiereLlave(vigente.rol)) {
    return { ok: true, autorizadoPor: null, liberar: SIN_LIBERAR };
  }
  if (!actor.llave) {
    logger.warn({ evento: 'llave_edicion_rechazada', userId: actor.userId, entidadTipo, entidadId, motivo: 'ausente' });
    return {
      ok: false,
      codigo: 403,
      error: 'Para editar este documento necesitas una llave de edición del administrador.',
    };
  }
  const consumo = await consumirLlave(actor.llave, entidadTipo, entidadId, actor.userId);
  if (!consumo.ok) return { ok: false, codigo: 403, error: consumo.error };
  return {
    ok: true,
    autorizadoPor: consumo.autorizadoPor,
    liberar: () => liberarLlave(consumo.llaveId, actor.userId),
  };
}
