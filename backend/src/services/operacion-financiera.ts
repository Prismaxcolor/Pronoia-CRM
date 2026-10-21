/** Ejecución idempotente de las operaciones que mueven dinero o saldos (pagos, cobros, notas de ajuste, facturas).
 *  Con `clientRequestId` el doble clic o el reintento por timeout devuelve el resultado original sin repetir el
 *  movimiento (mecanismo de operaciones_cliente, ver idempotencia-service.ts). Sin la clave (PWA vieja en caché) la
 *  operación sigue como siempre, pero se deja un aviso en el log para medir cuándo se puede volverla obligatoria. */
import type { Response } from 'express';
import { logger } from '../utils/logger.js';
import { ejecutarOperacion, type Idempotente, type MetaCliente, type TipoOperacion, type TipoOperacionConRecurso } from './operaciones-idempotentes-cola.js';

export const EVENTO_SIN_CLIENT_REQUEST_ID = 'operacion_sin_client_request_id';

export function avisarSiFaltaClave(tipo: string, meta: MetaCliente, usuarioId: string): void {
  if (meta.clientRequestId) return;
  logger.warn({ evento: EVENTO_SIN_CLIENT_REQUEST_ID, tipo, userId: usuarioId });
}

export async function ejecutarOperacionFinanciera<T>(
  res: Response,
  tipo: TipoOperacion | TipoOperacionConRecurso,
  meta: MetaCliente,
  usuarioId: string,
  fn: () => Promise<T>,
): Promise<Idempotente<T> | null> {
  avisarSiFaltaClave(tipo, meta, usuarioId);
  return ejecutarOperacion(res, tipo, meta, usuarioId, fn);
}
