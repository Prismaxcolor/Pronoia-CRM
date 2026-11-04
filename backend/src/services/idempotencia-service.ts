/** Idempotencia de operaciones enviadas por el cliente (modo sin conexión).
 *
 *  Cada operación trae un `clientRequestId` (UUID generado en el teléfono antes
 *  del primer intento). El reclamo se hace con la función SQL
 *  `reclamar_operacion_cliente` (docs/migration_operaciones_cliente.sql), que es
 *  atómica y serializa reintentos simultáneos. Resultado:
 *   - primera vez → se ejecuta `fn` y se guarda su resultado;
 *   - repetida (ya 'ok') → se devuelve el resultado guardado, sin ejecutar nada;
 *   - en proceso reciente → ErrorIdempotencia 409 con `reintentar: true`;
 *   - 'error' o 'procesando' vencido → se reintenta (antes se consulta
 *     `buscarExistente` por si el intento anterior sí llegó a crear el registro).
 *
 *  Con `clientRequestId`, si la tabla o las funciones no existen (migración sin
 *  aplicar) FALLA CERRADO: 503 reintentable, nunca se ejecuta sin idempotencia
 *  (un reintento del teléfono podría duplicar el registro). Sin `clientRequestId`
 *  la operación no pasa por aquí y se comporta como siempre. */
import type { Response } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { esErrorFuncionInexistente } from './ticket-principal.js';
import { limpiezaOportunista } from './operaciones-limpieza.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';

export class ErrorIdempotencia extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** true = el cliente debe reintentar más tarde (no es un rechazo definitivo). */
    readonly reintentar: boolean,
  ) {
    super(message);
    this.name = 'ErrorIdempotencia';
  }
}

export interface OpcionesIdempotencia<T> {
  /** Momento real de la captura en el teléfono (ISO). */
  capturadoEn?: string | null;
  /** Id de la entidad creada, para conciliar (operaciones_cliente.entidad_id). */
  entidadId?: (resultado: T) => string | null | undefined;
  /** Busca el registro que un intento anterior pudo haber creado (p. ej. por client_request_id). */
  buscarExistente?: () => Promise<T | null>;
}

interface RespuestaReclamo {
  accion: 'ejecutar' | 'repetida' | 'en_proceso' | 'conflicto';
  retomada?: boolean;
  resultado?: unknown;
}

const REINTENTOS_FINALIZAR = 2;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mensajeDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function textoErrorDelResultado(resultado: unknown): string | null {
  if (resultado && typeof resultado === 'object' && 'error' in resultado) {
    const err = (resultado as { error: unknown }).error;
    return typeof err === 'string' ? err : 'Error de negocio.';
  }
  return null;
}

/** Error 503 reintentable cuando la base de datos no tiene lo necesario para garantizar la idempotencia. */
export function errorIdempotenciaNoDisponible(): ErrorIdempotencia {
  return new ErrorIdempotencia('El servicio de sincronización no está disponible por ahora. Reintenta en unos minutos.', 503, true);
}

async function reclamar(id: string, tipo: string, usuarioId: string, capturadoEn: string | null | undefined): Promise<RespuestaReclamo> {
  const { data, error } = await supabaseAdmin.rpc('reclamar_operacion_cliente', {
    p_client_request_id: id,
    p_tipo: tipo,
    p_usuario_id: usuarioId,
    p_capturado_en: capturadoEn ?? null,
  });
  if (error) {
    if (esObjetoInexistente(error)) {
      logger.error({ evento: 'idempotencia_no_habilitada', mensaje: 'Falta docs/migration_operaciones_cliente.sql: se rechaza la operación (falla cerrado)' });
      throw errorIdempotenciaNoDisponible();
    }
    logger.error({ evento: 'idempotencia_reclamo_fallido', error: error.message });
    throw new ErrorIdempotencia('No se pudo verificar la operación. Intenta de nuevo.', 503, true);
  }
  return data as RespuestaReclamo;
}

async function finalizar(id: string, cambios: Record<string, unknown>): Promise<boolean> {
  for (let intento = 0; intento < REINTENTOS_FINALIZAR; intento += 1) {
    const { error } = await supabaseAdmin.from('operaciones_cliente').update(cambios).eq('client_request_id', id);
    if (!error) return true;
    logger.error({ evento: 'idempotencia_finalizar_fallido', error: error.message, intento });
  }
  return false;
}

async function marcarOk<T>(id: string, resultado: T, entidadId: string | null | undefined): Promise<void> {
  // Si no se pudo persistir, el registro queda 'procesando': un reintento lo
  // resolverá con buscarExistente en vez de duplicar.
  await finalizar(id, { estado: 'ok', resultado, entidad_id: entidadId ?? null, error: null });
}

async function marcarError(id: string, mensaje: string): Promise<void> {
  await finalizar(id, { estado: 'error', error: mensaje.slice(0, 500) });
}

async function recuperarExistente<T>(id: string, opciones: OpcionesIdempotencia<T>): Promise<T | null> {
  if (!opciones.buscarExistente) return null;
  const existente = await opciones.buscarExistente();
  if (!existente) return null;
  await marcarOk(id, existente, opciones.entidadId?.(existente));
  return existente;
}

async function ejecutarYGuardar<T>(id: string, fn: () => Promise<T>, opciones: OpcionesIdempotencia<T>): Promise<T> {
  let resultado: T;
  try {
    resultado = await fn();
  } catch (e) {
    await marcarError(id, mensajeDe(e));
    throw e;
  }
  const errorNegocio = textoErrorDelResultado(resultado);
  if (errorNegocio) {
    // Si el registro llegó a crearse a pesar del error (p. ej. falló la lectura de vuelta), un reintento lo encontrará.
    await marcarError(id, errorNegocio);
    return resultado;
  }
  await marcarOk(id, resultado, opciones.entidadId?.(resultado));
  return resultado;
}

/** Ejecuta `fn` una sola vez por `clientRequestId` (ver cabecera del archivo).
 *  Firma estable: la reutilizan otras fases. */
export async function ejecutarIdempotente<T>(
  clientRequestId: string,
  tipo: string,
  usuarioId: string,
  fn: () => Promise<T>,
  opciones: OpcionesIdempotencia<T> = {},
): Promise<{ resultado: T; repetida: boolean }> {
  if (!UUID_RE.test(clientRequestId)) {
    throw new ErrorIdempotencia('Identificador de operación inválido.', 400, false);
  }
  const reclamo = await reclamar(clientRequestId, tipo, usuarioId, opciones.capturadoEn);
  switch (reclamo.accion) {
    case 'repetida':
      return { resultado: reclamo.resultado as T, repetida: true };
    case 'en_proceso':
      throw new ErrorIdempotencia('Esta operación se está procesando. Se reintentará en unos segundos.', 409, true);
    case 'conflicto':
      throw new ErrorIdempotencia('Este identificador de operación ya se usó para otra cosa.', 409, false);
    case 'ejecutar':
      break;
    default:
      throw new ErrorIdempotencia('Respuesta de idempotencia desconocida.', 503, true);
  }

  if (!reclamo.retomada && process.env.NODE_ENV !== 'test') limpiezaOportunista();
  if (reclamo.retomada) {
    const existente = await recuperarExistente(clientRequestId, opciones);
    if (existente) return { resultado: existente, repetida: true };
  }
  return { resultado: await ejecutarYGuardar(clientRequestId, fn, opciones), repetida: false };
}

/** Si `e` es un ErrorIdempotencia responde la petición y devuelve true; si no, false (relanzar). */
export function responderErrorIdempotencia(res: Response, e: unknown): boolean {
  if (!(e instanceof ErrorIdempotencia)) return false;
  res.status(e.status).json({ error: e.message, reintentar: e.reintentar });
  return true;
}

type TablaConOrigen = 'tickets_pesaje' | 'tickets_traslado';

/** Guarda en el registro recién creado el id y la hora de captura del cliente. No falla la
 *  operación si no se puede (p. ej. columnas aún sin migrar): solo se registra el aviso. */
export async function marcarOrigenCliente(
  tabla: TablaConOrigen,
  id: string,
  origen: { clientRequestId?: string; capturadoEn?: string },
): Promise<void> {
  if (!origen.clientRequestId) return;
  const { error } = await supabaseAdmin
    .from(tabla)
    .update({ client_request_id: origen.clientRequestId, capturado_en: origen.capturadoEn ?? null })
    .eq('id', id);
  if (error) logger.warn({ evento: 'idempotencia_marcar_origen_fallido', tabla, id, error: error.message });
}

/** Id del registro creado por un intento anterior de esta operación, si existe. */
export async function buscarIdPorClientRequestId(tabla: TablaConOrigen, clientRequestId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from(tabla)
    .select('id')
    .eq('client_request_id', clientRequestId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

/** Crea un registro con el RPC original o, si la operación trae `clientRequestId`, con su envoltorio
 *  `<nombre>_idem`: la base de datos garantiza UNA sola fila por clientRequestId (búsqueda previa +
 *  creación + marca en una transacción, con candado y índice único). Si el envoltorio no existe
 *  FALLA CERRADO (503 reintentable): no se crea nada sin idempotencia. */
export async function llamarRpcCrear(
  nombre: 'crear_ticket_pesaje' | 'crear_traslado',
  tabla: TablaConOrigen,
  params: Record<string, unknown>,
  origen: { clientRequestId?: string; capturadoEn?: string },
): Promise<{ data: unknown; error: { message: string; code?: string } | null }> {
  if (!origen.clientRequestId) return supabaseAdmin.rpc(nombre, params);
  const idem = await supabaseAdmin.rpc(`${nombre}_idem`, {
    p_client_request_id: origen.clientRequestId,
    p_capturado_en: origen.capturadoEn ?? null,
    ...params,
  });
  if (!esErrorFuncionInexistente(idem.error)) return idem;
  logger.error({ evento: 'idempotencia_envoltorio_ausente', funcion: `${nombre}_idem`, mensaje: 'Falla cerrado: no se crea sin idempotencia' });
  throw errorIdempotenciaNoDisponible();
}
