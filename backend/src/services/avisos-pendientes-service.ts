import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { enviarN8n, urlDeDestino, type DestinoN8n } from './n8n-cliente.js';

const TABLA = 'avisos_pendientes';
/** Intentos totales (los inmediatos cuentan como 1 al encolar) antes de marcar el aviso como fallido. */
export const MAX_INTENTOS_COLA = 8;
export const LOTE_REPROCESO = 20;
const BACKOFF_BASE_MS = 5 * 60 * 1000;
const BACKOFF_MAX_MS = 2 * 60 * 60 * 1000;
/** Reserva de una fila mientras una corrida la procesa (evita que dos corridas la envíen a la vez). */
const RESERVA_MS = 10 * 60 * 1000;
const TIMEOUT_REPROCESO_MS = 8_000;
/** Presupuesto de una corrida: la función serverless tiene tiempo limitado. */
const PRESUPUESTO_MS = 30_000;
const MAX_ERROR_CHARS = 500;

export interface AvisoPendiente {
  id: string;
  destino: DestinoN8n;
  payload: Record<string, unknown>;
  intentos: number;
  proximo_intento: string;
}

export interface ResumenReproceso {
  revisados: number;
  enviados: number;
  reprogramados: number;
  fallidos: number;
  omitidos: number;
}

/** Espera antes del intento n+1: 5 min, 10, 20... tope 2 h. */
export function esperaTrasIntentos(intentos: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(intentos - 1, 0), BACKOFF_MAX_MS);
}

const recortarError = (t: string): string => t.slice(0, MAX_ERROR_CHARS);

/**
 * Guarda un aviso que no se pudo entregar. NUNCA lanza: la operación de negocio no debe fallar
 * por esto. El payload no debe contener secretos (el header de n8n se agrega al enviar).
 */
export async function encolarAviso(
  destino: DestinoN8n,
  payload: Record<string, unknown>,
  ultimoError: string,
  intentos: number,
  ahora: Date = new Date()
): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.from(TABLA).insert({
      destino,
      payload,
      intentos,
      ultimo_error: recortarError(ultimoError),
      proximo_intento: new Date(ahora.getTime() + esperaTrasIntentos(intentos)).toISOString(),
    });
    if (error) {
      logger.error({ evento: 'avisos_cola_error_insertar', destino, mensaje: error.message });
      return false;
    }
    logger.warn({ evento: 'avisos_cola_encolado', destino, intentos });
    return true;
  } catch (err) {
    logger.error({ evento: 'avisos_cola_error_insertar', destino, mensaje: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

async function listarVencidos(ahora: Date, limite: number): Promise<AvisoPendiente[]> {
  const { data, error } = await supabaseAdmin
    .from(TABLA)
    .select('id, destino, payload, intentos, proximo_intento')
    .is('enviado_en', null)
    .is('fallido_en', null)
    .lte('proximo_intento', ahora.toISOString())
    .order('proximo_intento', { ascending: true })
    .limit(limite);
  if (error) throw new Error(error.message);
  return (data ?? []) as AvisoPendiente[];
}

/** Reserva la fila moviendo proximo_intento hacia adelante; false si otra corrida se la llevó. */
async function reservar(aviso: AvisoPendiente, ahora: Date): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from(TABLA)
    .update({ proximo_intento: new Date(ahora.getTime() + RESERVA_MS).toISOString() })
    .eq('id', aviso.id)
    .eq('proximo_intento', aviso.proximo_intento)
    .is('enviado_en', null)
    .is('fallido_en', null)
    .select('id');
  return !error && Array.isArray(data) && data.length > 0;
}

async function marcar(id: string, cambios: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin.from(TABLA).update(cambios).eq('id', id);
  if (error) logger.error({ evento: 'avisos_cola_error_actualizar', id, mensaje: error.message });
}

type Veredicto = 'enviado' | 'reprogramado' | 'fallido' | 'omitido';

async function procesarUno(aviso: AvisoPendiente, ahora: Date): Promise<Veredicto> {
  if (!(await reservar(aviso, ahora))) return 'omitido';
  const url = urlDeDestino(aviso.destino);
  const intentos = aviso.intentos + 1;
  const resultado = url
    ? await enviarN8n(url, aviso.payload, { timeoutMs: TIMEOUT_REPROCESO_MS, maxIntentos: 1 })
    : { ok: false, transitorio: false, error: 'webhook no configurado' };
  if (resultado.ok) {
    await marcar(aviso.id, { enviado_en: ahora.toISOString(), intentos, ultimo_error: null });
    return 'enviado';
  }
  const error = recortarError(resultado.error ?? 'error desconocido');
  // Un 4xx no se arregla reintentando; un webhook sin configurar tampoco hasta que alguien lo configure.
  if (intentos >= MAX_INTENTOS_COLA || (!resultado.transitorio && url)) {
    await marcar(aviso.id, { fallido_en: ahora.toISOString(), intentos, ultimo_error: error });
    logger.error({ evento: 'avisos_cola_fallido', id: aviso.id, destino: aviso.destino, intentos, mensaje: error });
    return 'fallido';
  }
  const proximo = new Date(ahora.getTime() + esperaTrasIntentos(intentos)).toISOString();
  await marcar(aviso.id, { intentos, ultimo_error: error, proximo_intento: proximo });
  return 'reprogramado';
}

/** Reintenta los avisos vencidos (por lotes, con presupuesto de tiempo). Lanza solo si no puede leer la cola. */
export async function reprocesarAvisosPendientes(
  ahora: () => Date = () => new Date(),
  limite: number = LOTE_REPROCESO
): Promise<ResumenReproceso> {
  const inicio = ahora().getTime();
  const resumen: ResumenReproceso = { revisados: 0, enviados: 0, reprogramados: 0, fallidos: 0, omitidos: 0 };
  const avisos = await listarVencidos(ahora(), limite);
  for (const aviso of avisos) {
    if (ahora().getTime() - inicio > PRESUPUESTO_MS) break;
    resumen.revisados++;
    const veredicto = await procesarUno(aviso, ahora());
    if (veredicto === 'enviado') resumen.enviados++;
    else if (veredicto === 'reprogramado') resumen.reprogramados++;
    else if (veredicto === 'fallido') resumen.fallidos++;
    else resumen.omitidos++;
  }
  return resumen;
}
