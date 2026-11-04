import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { esColumnaInexistente } from '../utils/migracion-pendiente.js';
import { aMinimo, aTasa } from '../schemas/cochinito.js';
import { MENSAJE_ERROR_GENERICO, mensajeDeErrorBd } from '../utils/errores-bd.js';
import { reglaDeBanca, type ReglaComisionAutomatica } from '../utils/comision-automatica.js';

/**
 * Lectura de la regla de comisión automática de las cuentas (docs/migration_comision_automatica_banca.sql).
 * Mientras la migración no esté aplicada (columnas inexistentes) ninguna cuenta tiene regla: todo se comporta como antes.
 * Cualquier OTRO error de lectura falla cerrado: lanza `ComisionAutomaticaNoDisponibleError` para que quien registra el
 * movimiento lo rechace (503) en vez de registrarlo sin la comisión que la cuenta exige.
 */

export const MENSAJE_COMISION_AUTO_NO_VERIFICABLE =
  'No se pudo verificar la comisión automática de la cuenta, así que el movimiento no se registró. Intenta de nuevo en unos minutos.';

export class ComisionAutomaticaNoDisponibleError extends Error {
  constructor() {
    super(MENSAJE_COMISION_AUTO_NO_VERIFICABLE);
    this.name = 'ComisionAutomaticaNoDisponibleError';
  }
}

function falloDeLectura(mensaje: string): ComisionAutomaticaNoDisponibleError {
  logger.error({ evento: 'comision_automatica_lectura_fallida', mensaje });
  return new ComisionAutomaticaNoDisponibleError();
}

/** Reglas de las cuentas indicadas que tienen comisión automática (las demás no aparecen en el mapa). */
export async function reglasAutomaticasDe(bancaIds: readonly string[]): Promise<Map<string, ReglaComisionAutomatica>> {
  const reglas = new Map<string, ReglaComisionAutomatica>();
  const ids = [...new Set(bancaIds)];
  if (ids.length === 0) return reglas;
  const { data, error } = await supabaseAdmin.from('bancas').select('id, comision_auto_tasa, comision_auto_minimo').in('id', ids);
  if (error) {
    if (esColumnaInexistente(error, 'comision_auto_tasa')) return reglas;
    throw falloDeLectura(error.message);
  }
  for (const fila of (data as Array<{ id: string; comision_auto_tasa: unknown; comision_auto_minimo: unknown }> | null) ?? []) {
    const regla = reglaDeBanca(fila);
    if (regla) reglas.set(String(fila.id), regla);
  }
  return reglas;
}

/** Regla de UNA cuenta, o null si no tiene comisión automática. */
export async function reglaAutomaticaDe(bancaId: string): Promise<ReglaComisionAutomatica | null> {
  const { data, error } = await supabaseAdmin.from('bancas').select('comision_auto_tasa, comision_auto_minimo').eq('id', bancaId).maybeSingle();
  if (error) {
    if (esColumnaInexistente(error, 'comision_auto_tasa')) return null;
    throw falloDeLectura(error.message);
  }
  return reglaDeBanca(data as { comision_auto_tasa?: unknown; comision_auto_minimo?: unknown } | null);
}

export const MENSAJE_COMISION_AUTO_PENDIENTE =
  'La comisión automática por cuenta aún no está habilitada en la base de datos (falta aplicar migration_comision_automatica_banca.sql).';

export type ResultadoGuardarRegla =
  | { regla: ReglaComisionAutomatica | null; anterior: ReglaComisionAutomatica | null }
  | { error: string; pendiente?: boolean; noEncontrada?: boolean };


/**
 * Guarda (o quita) la regla de comisión automática de UNA cuenta. Solo afecta a los movimientos que se registren
 * después: los ya hechos conservan su comisión. `activa = false` deja las dos columnas en null (sin regla).
 * Devuelve la regla anterior para auditar. Sin la migración aplicada => `pendiente` (el llamador responde 409).
 */
export async function guardarReglaDeBanca(
  bancaId: string,
  input: { activa: boolean; porcentaje: number; minimo: number }
): Promise<ResultadoGuardarRegla> {
  const lectura = await supabaseAdmin.from('bancas').select('id, comision_auto_tasa, comision_auto_minimo').eq('id', bancaId).maybeSingle();
  if (lectura.error) {
    if (esColumnaInexistente(lectura.error, 'comision_auto_tasa')) return { error: MENSAJE_COMISION_AUTO_PENDIENTE, pendiente: true };
    logger.error({ evento: 'comision_automatica_lectura_fallida', mensaje: lectura.error.message });
    return { error: 'No se pudo leer la cuenta.' };
  }
  if (!lectura.data) return { error: 'Banca no encontrada.', noEncontrada: true };
  const anterior = reglaDeBanca(lectura.data as { comision_auto_tasa?: unknown; comision_auto_minimo?: unknown });

  const columnas = input.activa
    ? { comision_auto_tasa: aTasa(input.porcentaje), comision_auto_minimo: aMinimo(input.minimo) }
    : { comision_auto_tasa: null, comision_auto_minimo: null };
  const { error } = await supabaseAdmin.from('bancas').update(columnas).eq('id', bancaId);
  if (error) {
    if (esColumnaInexistente(error, 'comision_auto_tasa')) return { error: MENSAJE_COMISION_AUTO_PENDIENTE, pendiente: true };
    logger.error({ evento: 'comision_automatica_guardado_fallido', code: error.code, mensaje: error.message });
    return { error: mensajeDeErrorBd(error, MENSAJE_ERROR_GENERICO) };
  }
  return { regla: reglaDeBanca(columnas), anterior };
}
