import { supabaseAdmin } from '../config/supabase.js';
import { LIMITE_PREGUNTAS_DIARIAS } from '../utils/asistente-limites.js';
import { logger } from '../utils/logger.js';

/** Cuánto se recuerda que un usuario está activo (evita una consulta a la BD por cada pregunta). */
export const TTL_USUARIO_ACTIVO_MS = 60_000;

export const MENSAJE_USUARIO_INACTIVO = 'Tu usuario no está activo. Inicia sesión de nuevo o consulta al administrador.';
export const MENSAJE_LIMITE_DIARIO = 'Ya hablamos mucho hoy, mañana sigo. 🫧';

export interface DepsAcceso {
  /** true = existe y está activo; false = no existe o inactivo. Lanza si no se pudo consultar. */
  usuarioActivo: (userId: string) => Promise<boolean>;
  /** true = permitido (y contado); false = límite diario alcanzado. Lanza si falla. */
  registrarUso: (userId: string, limite: number) => Promise<boolean>;
  ahora: () => number;
}

export type ResultadoAcceso = { ok: true } | { ok: false; status: 401 | 429 | 503; error: string };

const consultarUsuarioActivo: DepsAcceso['usuarioActivo'] = async userId => {
  const { data, error } = await supabaseAdmin.from('users').select('activo').eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data?.activo);
};

const registrarUsoEnBD: DepsAcceso['registrarUso'] = async (userId, limite) => {
  const { data, error } = await supabaseAdmin.rpc('asistente_registrar_uso', { p_user: userId, p_limite: limite });
  if (error) throw new Error(error.message);
  return data === true;
};

const DEPS_REALES: DepsAcceso = { usuarioActivo: consultarUsuarioActivo, registrarUso: registrarUsoEnBD, ahora: Date.now };

/** Solo se cachean los activos: una baja se nota en cuanto vence el TTL. */
const cacheActivos = new Map<string, number>();

export function reiniciarCacheAcceso(): void {
  cacheActivos.clear();
}

/**
 * Antes de responder: el usuario debe existir y estar activo (JWT vigente no basta) y no haber
 * superado el tope diario. El conteo falla abierto: si la tabla/función falla, BLOB sigue.
 */
export async function verificarAcceso(
  userId: string,
  deps: DepsAcceso = DEPS_REALES,
  limite: number = LIMITE_PREGUNTAS_DIARIAS,
): Promise<ResultadoAcceso> {
  const ahora = deps.ahora();
  const venceActivo = cacheActivos.get(userId);
  if (venceActivo === undefined || venceActivo <= ahora) {
    cacheActivos.delete(userId);
    try {
      if (!(await deps.usuarioActivo(userId))) return { ok: false, status: 401, error: MENSAJE_USUARIO_INACTIVO };
    } catch (err) {
      logger.error({ evento: 'asistente_usuario_error', userId, mensaje: err instanceof Error ? err.message : 'desconocido' });
      return { ok: false, status: 503, error: 'BLOB no pudo verificar tu usuario. Intenta de nuevo en un momento.' };
    }
    cacheActivos.set(userId, ahora + TTL_USUARIO_ACTIVO_MS);
  }

  try {
    if (!(await deps.registrarUso(userId, limite))) {
      return { ok: false, status: 429, error: MENSAJE_LIMITE_DIARIO };
    }
  } catch (err) {
    logger.error({ evento: 'asistente_uso_error', userId, mensaje: err instanceof Error ? err.message : 'desconocido' });
  }
  return { ok: true };
}
