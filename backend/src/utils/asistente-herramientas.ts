/**
 * Registro y ejecución de las herramientas de consulta de BLOB (function calling, SOLO LECTURA).
 *
 * AUTORIZACIÓN (lado servidor, nunca confiar en el cliente):
 *   1. `cargarContextoPermisos` lee de la BD el rol y los permisos personalizados del usuario
 *      (misma regla que requirePermiso: los personalizados reemplazan a los del rol; el
 *      superadmin lo puede todo; un usuario inactivo no puede nada).
 *   2. `herramientasPermitidas` filtra el registro: al modelo SOLO se le ofrecen las herramientas
 *      cuyos permisos cumple el usuario.
 *   3. `ejecutarHerramienta` vuelve a verificar el permiso en cada llamada, aunque el modelo
 *      invoque una herramienta que no se le ofreció (p. ej. por inyección de instrucciones).
 *
 * PRIVACIDAD: los resultados de las herramientas se envían a OpenAI para redactar la respuesta.
 * Por eso devuelven datos mínimos y acotados (ver asistente-herr-base.ts) y el log de cada
 * llamada guarda usuario, herramienta, parámetros saneados y número de filas, NUNCA el resultado.
 */
import { supabaseAdmin } from '../config/supabase.js';
import { logger } from './logger.js';
import {
  permisosEfectivos,
  tienePermiso,
  type Permiso,
  type RolUsuario,
} from './permisos.js';
import { fechaHoy, serializarAcotado, type HerramientaAsistente } from './asistente-herr-base.js';
import { HERRAMIENTAS_OPERACION } from './asistente-herr-operacion.js';
import { HERRAMIENTAS_DINERO } from './asistente-herr-dinero.js';

export type { HerramientaAsistente } from './asistente-herr-base.js';

export const HERRAMIENTAS_ASISTENTE: readonly HerramientaAsistente[] = [
  ...HERRAMIENTAS_OPERACION,
  ...HERRAMIENTAS_DINERO,
];

// ---------------------------------------------------------------------------
// Permisos del usuario
// ---------------------------------------------------------------------------

export interface ContextoPermisos {
  rol: RolUsuario;
  permisos: Permiso[];
}

/** Permisos efectivos desde la BD; null si el usuario no existe o está inactivo. */
export async function cargarContextoPermisos(userId: string): Promise<ContextoPermisos | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('rol, permisos, activo')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data || !data.activo) return null;
  const rol = data.rol as RolUsuario;
  return { rol, permisos: permisosEfectivos(rol, data.permisos as Permiso[] | null) };
}

/** Cumple TODOS los permisos de la herramienta (el superadmin siempre cumple). */
export function puedeUsar(herramienta: HerramientaAsistente, contexto: ContextoPermisos): boolean {
  if (contexto.rol === 'superadmin') return true;
  return herramienta.permisos.every(p => tienePermiso(contexto.permisos, p.recurso, p.accion));
}

export function herramientasPermitidas(
  contexto: ContextoPermisos,
  registro: readonly HerramientaAsistente[] = HERRAMIENTAS_ASISTENTE,
): HerramientaAsistente[] {
  return registro.filter(h => puedeUsar(h, contexto));
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

export interface SalidaHerramienta {
  /** Texto (JSON) que se entrega al modelo como resultado de la herramienta. */
  contenido: string;
  /** 'ok' | 'sin_permiso' | 'no_existe' | 'argumentos' | 'error' */
  estado: 'ok' | 'sin_permiso' | 'no_existe' | 'argumentos' | 'error';
  /** Etiqueta para "Consulté: ..." solo si la consulta se hizo de verdad. */
  etiqueta?: string;
}

const MENSAJE_SIN_PERMISO =
  'PERMISO_DENEGADO: el usuario no tiene permiso para esta consulta. Dile con naturalidad que no tiene permiso para consultar eso y no intentes otra vía.';

/** Parámetros ya validados, recortados para el log (sin textos largos). */
function parametrosParaLog(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object') return {};
  return Object.fromEntries(
    Object.entries(args as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 40) : v]),
  );
}

export async function ejecutarHerramienta(
  nombre: string,
  argumentosJson: string,
  opciones: { userId: string; contexto: ContextoPermisos; registro?: readonly HerramientaAsistente[]; ahora?: Date },
): Promise<SalidaHerramienta> {
  const { userId, contexto } = opciones;
  const herramienta = (opciones.registro ?? HERRAMIENTAS_ASISTENTE).find(h => h.nombre === nombre);
  const auditar = (estado: SalidaHerramienta['estado'], extra: Record<string, unknown> = {}) =>
    logger.info({ evento: 'asistente_herramienta', userId, herramienta: nombre, estado, ...extra });

  if (!herramienta) {
    auditar('no_existe');
    return { estado: 'no_existe', contenido: JSON.stringify({ error: 'Esa herramienta no existe.' }) };
  }
  // Segunda verificación: independiente de lo que se le ofreció al modelo.
  if (!puedeUsar(herramienta, contexto)) {
    auditar('sin_permiso');
    return { estado: 'sin_permiso', contenido: MENSAJE_SIN_PERMISO };
  }

  let crudo: unknown;
  try {
    crudo = argumentosJson.trim() ? JSON.parse(argumentosJson) : {};
  } catch {
    auditar('argumentos');
    return { estado: 'argumentos', contenido: JSON.stringify({ error: 'Los parámetros no son JSON válido.' }) };
  }
  const validado = herramienta.parametros.safeParse(crudo);
  if (!validado.success) {
    auditar('argumentos');
    return { estado: 'argumentos', contenido: JSON.stringify({ error: 'Parámetros inválidos.', detalle: validado.error.issues.map(i => i.message).slice(0, 3) }) };
  }

  try {
    const { filas, datos } = await herramienta.ejecutar(validado.data, { userId, hoy: fechaHoy(opciones.ahora) });
    auditar('ok', { parametros: parametrosParaLog(validado.data), filas });
    const { texto } = serializarAcotado({ ...(datos as object), consultadoEl: fechaHoy(opciones.ahora) });
    return { estado: 'ok', contenido: texto, etiqueta: herramienta.etiqueta };
  } catch (err) {
    // Se registra el error (sin datos) y al modelo solo le llega un mensaje genérico.
    logger.warn({ evento: 'asistente_herramienta_error', userId, herramienta: nombre, mensaje: err instanceof Error ? err.message : 'desconocido' });
    return { estado: 'error', contenido: JSON.stringify({ error: 'No pude consultar eso ahora mismo.' }) };
  }
}
