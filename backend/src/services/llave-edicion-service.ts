import { supabaseAdmin } from '../config/supabase.js';
import {
  calcularExpiracion,
  evaluarLlave,
  generarCodigoLlave,
  hashLlave,
  mensajeLlaveInvalida,
  type LlaveRegistro,
  type MotivoLlaveInvalida,
} from '../utils/llave-edicion.js';
import { TABLA_POR_ENTIDAD, type EntidadConLlave } from '../utils/auditoria.js';
import { logger } from '../utils/logger.js';

export interface LlaveCreada {
  codigo: string;
  expiraEn: string;
}

export type ConsumoLlave =
  | { ok: true; llaveId: string; autorizadoPor: string | null }
  | { ok: false; error: string };

export type ResultadoCrearLlave = LlaveCreada | { error: string; codigo: number };

interface LlaveRow {
  id: string;
  entidad_tipo: string;
  entidad_id: string;
  creada_por: string | null;
  expira_en: string;
  usada_en: string | null;
}

const MSG_NO_DISPONIBLE = 'El sistema de llaves de edición no está disponible en este momento.';

/** Verifica que el documento exista. Distingue "no existe" (404) de "BD/tabla no disponible" (503). */
export async function verificarEntidad(entidadTipo: EntidadConLlave, entidadId: string): Promise<{ error: string; codigo: number } | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLA_POR_ENTIDAD[entidadTipo])
    .select('id')
    .eq('id', entidadId)
    .maybeSingle();
  if (error) return { error: MSG_NO_DISPONIBLE, codigo: 503 };
  if (!data) return { error: 'El documento indicado no existe.', codigo: 404 };
  return null;
}

/** Crea una llave de un solo uso ligada a un documento existente. Solo se guarda el hash. */
export async function crearLlave(
  entidadTipo: EntidadConLlave,
  entidadId: string,
  creadaPor: string
): Promise<ResultadoCrearLlave> {
  const rechazo = await verificarEntidad(entidadTipo, entidadId);
  if (rechazo) return rechazo;

  const codigo = generarCodigoLlave();
  const expiraEn = calcularExpiracion(new Date());
  const { error } = await supabaseAdmin.from('llaves_edicion').insert({
    token_hash: hashLlave(codigo),
    entidad_tipo: entidadTipo,
    entidad_id: entidadId,
    creada_por: creadaPor,
    expira_en: expiraEn.toISOString(),
  });
  if (error) {
    logger.error({ evento: 'llave_edicion_no_creada', userId: creadaPor, entidadTipo, entidadId, motivo: error.message });
    return {
      error: 'No se pudo generar la llave: el sistema de llaves no está disponible (¿migración de auditoría pendiente?).',
      codigo: 503,
    };
  }
  return { codigo, expiraEn: expiraEn.toISOString() };
}

function toRegistro(row: LlaveRow): LlaveRegistro {
  return {
    entidadTipo: row.entidad_tipo,
    entidadId: row.entidad_id,
    expiraEn: new Date(row.expira_en),
    usadaEn: row.usada_en ? new Date(row.usada_en) : null,
  };
}

/** Explica por qué una llave no se pudo consumir (solo para el mensaje de error). */
async function motivoDeRechazo(hash: string, entidadTipo: string, entidadId: string): Promise<MotivoLlaveInvalida> {
  const { data } = await supabaseAdmin
    .from('llaves_edicion')
    .select('id, entidad_tipo, entidad_id, creada_por, expira_en, usada_en')
    .eq('token_hash', hash)
    .maybeSingle();
  const evaluacion = evaluarLlave(data ? toRegistro(data as LlaveRow) : null, { entidadTipo, entidadId }, new Date());
  // Si evalúa como válida es porque otra petición la consumió justo antes.
  return evaluacion.valida ? 'usada' : evaluacion.motivo;
}

/**
 * Valida y consume la llave en UNA sola sentencia (update condicional): si dos
 * peticiones usan la misma llave a la vez, solo una gana. Exige coincidencia
 * de documento, que no esté usada y que no haya expirado.
 */
export async function consumirLlave(
  codigo: string,
  entidadTipo: EntidadConLlave,
  entidadId: string,
  usadaPor: string
): Promise<ConsumoLlave> {
  const hash = hashLlave(codigo);
  const ahora = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('llaves_edicion')
    .update({ usada_en: ahora, usada_por: usadaPor })
    .eq('token_hash', hash)
    .eq('entidad_tipo', entidadTipo)
    .eq('entidad_id', entidadId)
    .is('usada_en', null)
    .gt('expira_en', ahora)
    .select('id, creada_por');

  if (error) {
    logger.error({ evento: 'llave_edicion_error_bd', userId: usadaPor, entidadTipo, entidadId, motivo: error.message });
    return { ok: false, error: MSG_NO_DISPONIBLE };
  }
  const fila = (data ?? [])[0] as { id: string; creada_por: string | null } | undefined;
  if (!fila) {
    const motivo = await motivoDeRechazo(hash, entidadTipo, entidadId);
    logger.warn({ evento: 'llave_edicion_rechazada', userId: usadaPor, entidadTipo, entidadId, motivo });
    return { ok: false, error: mensajeLlaveInvalida(motivo) };
  }
  logger.info({ evento: 'llave_edicion_consumida', userId: usadaPor, entidadTipo, entidadId, llaveId: fila.id });
  return { ok: true, llaveId: fila.id, autorizadoPor: fila.creada_por };
}

/**
 * Devuelve la llave a "disponible" cuando la edición que la consumió falló.
 * Solo si la consumió este mismo usuario. Best-effort: loguea si falla.
 */
export async function liberarLlave(llaveId: string, usuarioId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('llaves_edicion')
    .update({ usada_en: null, usada_por: null })
    .eq('id', llaveId)
    .eq('usada_por', usuarioId)
    .select('id');
  if (error) {
    logger.error({ evento: 'llave_edicion_no_liberada', userId: usuarioId, llaveId, motivo: error.message });
    return;
  }
  logger.info({ evento: 'llave_edicion_liberada', userId: usuarioId, llaveId, liberada: (data ?? []).length > 0 });
}
