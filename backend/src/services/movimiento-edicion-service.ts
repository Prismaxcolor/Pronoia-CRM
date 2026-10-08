import { supabaseAdmin } from '../config/supabase.js';
import { autorizarEdicion, type ActorEdicion } from './edicion-autorizada-service.js';
import { nombreDeUsuario, registrarAuditoria } from './auditoria-service.js';
import { obtenerMovimiento, type Movimiento } from './banca-service.js';
import { calcularCambios, type CambiosAuditoria } from '../utils/auditoria.js';
import type { EditarMovimientoInput } from '../schemas/transacciones-editar.js';
import {
  errorDeRpcTransaccion,
  esEdicionContableMovimiento,
  parametrosCamposMovimiento,
  parametrosContablesMovimiento,
  resumirMovimiento,
  type ErrorTransaccion,
} from '../utils/transaccion-edicion.js';
import { logger } from '../utils/logger.js';

export interface ResultadoMovimientoEdicion {
  movimiento: Movimiento;
  /** Nombre de quien entregó la llave (null si lo hizo un superadmin o un rol sin llave). */
  autorizadoPor: string | null;
  cambios: CambiosAuditoria;
  advertencia?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MSG_NO_ENCONTRADO = 'Movimiento no encontrado.';
const MSG_SIN_REGISTRO_HISTORIAL =
  'El cambio se guardó, pero no se pudo registrar en el historial de ediciones. Avisa al administrador.';
const MSG_DE_UN_PAGO =
  'Este movimiento forma parte de un pago o cobro: edítalo o anúlalo desde el pago/cobro completo (estado de cuenta).';

async function nombresDeBancas(ids: ReadonlyArray<string | null>): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => !!x))];
  const nombres = new Map<string, string>();
  if (unicos.length === 0) return nombres;
  const { data } = await supabaseAdmin.from('bancas').select('id, nombre').in('id', unicos);
  for (const b of (data as Array<{ id: string; nombre: string }> | null) ?? []) nombres.set(b.id, b.nombre);
  return nombres;
}

/** Lee el movimiento y rechaza los que no se gestionan sueltos (de un pago/cobro) o ya anulados. */
async function cargarMovimientoManual(id: string): Promise<Movimiento | ErrorTransaccion> {
  if (!UUID_RE.test(id)) return { error: MSG_NO_ENCONTRADO, codigo: 404 };
  const mov = await obtenerMovimiento(id);
  if (!mov) return { error: MSG_NO_ENCONTRADO, codigo: 404 };
  if (mov.grupoId !== null || mov.subtipo !== null) return { error: MSG_DE_UN_PAGO, codigo: 409 };
  if (mov.anulado) return { error: 'Este movimiento ya fue anulado.', codigo: 409 };
  return mov;
}

async function cerrarOperacion(
  id: string,
  antes: Movimiento,
  actor: ActorEdicion,
  autorizadoPor: string | null,
  accion: 'editar' | 'anular'
): Promise<ResultadoMovimientoEdicion | ErrorTransaccion> {
  const despues = await obtenerMovimiento(id);
  if (!despues) return { error: 'El cambio se guardó, pero no se pudo leer de vuelta.', codigo: 500 };

  const nombres = await nombresDeBancas([antes.bancaOrigenId, antes.bancaDestinoId, despues.bancaOrigenId, despues.bancaDestinoId]);
  const cambios = calcularCambios(resumirMovimiento(antes, nombres), resumirMovimiento(despues, nombres));
  const registrada = await registrarAuditoria({
    entidadTipo: 'movimiento_banca',
    entidadId: id,
    accion,
    usuarioId: actor.userId,
    usuarioEmail: actor.email,
    autorizadoPor,
    cambios,
  });
  logger.info({
    evento: accion === 'anular' ? 'movimiento_banca_anulado' : 'movimiento_banca_editado',
    userId: actor.userId,
    movimientoId: id,
    autorizadoPor,
  });
  return {
    movimiento: despues,
    autorizadoPor: autorizadoPor ? await nombreDeUsuario(autorizadoPor) : null,
    cambios,
    ...(registrada ? {} : { advertencia: MSG_SIN_REGISTRO_HISTORIAL }),
  };
}

/**
 * Anula un movimiento de banca manual (ingreso, egreso o transferencia) con llave de edición:
 * revierte el saldo de la(s) banca(s) y marca la fila (nunca se borra). Los movimientos que
 * pertenecen a un pago/cobro se anulan por el pago.
 */
export async function anularMovimientoBanca(
  id: string,
  motivo: string,
  actor: ActorEdicion
): Promise<ResultadoMovimientoEdicion | ErrorTransaccion> {
  const antes = await cargarMovimientoManual(id);
  if ('error' in antes) return antes;

  const auth = await autorizarEdicion(actor, 'movimiento_banca', id);
  if (!auth.ok) return { error: auth.error, codigo: auth.codigo };

  const { error } = await supabaseAdmin.rpc('anular_movimiento_banca', { p_id: id, p_motivo: motivo, p_usuario: actor.userId });
  if (error) {
    await auth.liberar();
    return errorDeRpcTransaccion(error);
  }
  return cerrarOperacion(id, antes, actor, auth.autorizadoPor, 'anular');
}

/**
 * Edita un movimiento de banca manual con llave de edición. Campos libres: concepto, referencia, fecha,
 * comprobantes. Contables: banca(s), monto, moneda, monto destino y proveedor/cliente (la RPC revierte el
 * efecto anterior y aplica el nuevo validando saldos). El tipo no cambia.
 */
export async function editarMovimientoBanca(
  id: string,
  input: EditarMovimientoInput,
  actor: ActorEdicion
): Promise<ResultadoMovimientoEdicion | ErrorTransaccion> {
  const antes = await cargarMovimientoManual(id);
  if ('error' in antes) return antes;

  const auth = await autorizarEdicion(actor, 'movimiento_banca', id);
  if (!auth.ok) return { error: auth.error, codigo: auth.codigo };

  const { error } = esEdicionContableMovimiento(input)
    ? await supabaseAdmin.rpc('editar_movimiento_banca_contable', parametrosContablesMovimiento(id, input, antes, actor.userId))
    : await supabaseAdmin.rpc('editar_movimiento_banca_campos', parametrosCamposMovimiento(id, input, actor.userId));
  if (error) {
    await auth.liberar();
    return errorDeRpcTransaccion(error);
  }
  return cerrarOperacion(id, antes, actor, auth.autorizadoPor, 'editar');
}
