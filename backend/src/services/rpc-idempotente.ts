/** Llamada a un RPC de creación con la garantía de «una sola fila» en la base de datos (Fase 4).
 *
 *  Con `clientRequestId` se llama al envoltorio `*_idem` (candado + búsqueda por clave + creación + marca,
 *  todo en una transacción; ver docs/migration_operaciones_cliente_f4.sql). Sin clave, o si el envoltorio
 *  no existe (migración sin aplicar), falla cerrado con 503 reintentable. */
import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { esErrorFuncionInexistente } from './ticket-principal.js';
import { errorIdempotenciaNoDisponible } from './idempotencia-service.js';

export interface OpcionesRpcIdempotente {
  clientRequestId?: string;
  capturadoEn?: string;
  /** Nombre del envoltorio, p. ej. 'registrar_pesaje_toma_fisica_idem'. */
  envoltorio: string;
  /** Nombre del RPC original. */
  original: string;
  /** Argumentos del RPC original; el envoltorio recibe los mismos más la clave y la hora de captura. */
  args: Record<string, unknown>;
  /** Argumentos que solo el envoltorio exige (p. ej. un parámetro opcional del original que el envoltorio recibe siempre). */
  extraEnvoltorio?: Record<string, unknown>;
  /** Argumentos del original que el envoltorio NO recibe. */
  omitirEnvoltorio?: readonly string[];
}

export async function rpcConIdempotencia(o: OpcionesRpcIdempotente) {
  if (!o.clientRequestId) return supabaseAdmin.rpc(o.original, o.args);
  const argsEnvoltorio = Object.fromEntries(Object.entries(o.args).filter(([k]) => !o.omitirEnvoltorio?.includes(k)));
  const respuesta = await supabaseAdmin.rpc(o.envoltorio, {
    p_client_request_id: o.clientRequestId,
    p_capturado_en: o.capturadoEn ?? null,
    ...argsEnvoltorio,
    ...o.extraEnvoltorio,
  });
  if (respuesta.error && esErrorFuncionInexistente(respuesta.error)) {
    logger.error({ evento: 'idempotencia_bd_no_habilitada', envoltorio: o.envoltorio, mensaje: 'Falta aplicar docs/migration_operaciones_cliente_f4.sql: falla cerrado' });
    throw errorIdempotenciaNoDisponible();
  }
  return respuesta;
}
