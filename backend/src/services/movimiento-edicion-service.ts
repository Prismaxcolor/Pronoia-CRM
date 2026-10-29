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
const MSG_MESA_SIN_CAMBIOS_CONTABLES =
  'Esta transferencia usa una mesa de cambio: no se pueden cambiar sus montos ni sus cuentas. Anúlala y regístrala de nuevo.';
const MSG_COMISION_SIN_CAMBIOS_CONTABLES =
  'Este movimiento lleva comisión bancaria: no se pueden cambiar sus montos ni sus cuentas. Anúlalo (se anula también su comisión) y regístralo de nuevo.';
const MSG_ANULAR_MESA_SIN_PERMISO =
  'Esta transferencia usa una mesa de cambio: para anularla necesitas además acceso a la mesa de cambio.';
const MSG_ES_COMISION =
  'Este movimiento es la comisión bancaria de otro: no se edita ni se anula por separado, se anula junto con su movimiento.';
const MSG_ES_COMISION_MESA =
  'Este movimiento es la comisión de una transferencia con mesa de cambio: no se edita ni se anula por separado, se anula junto con la transferencia.';
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
  if (mov.comisionDeId) return { error: MSG_ES_COMISION, codigo: 409 };
  if (mov.mesaComisionDeId) return { error: MSG_ES_COMISION_MESA, codigo: 409 };
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

/** Elige la RPC de anulación: la mesa de cambio revierte al cambista; la comisión bancaria se anula junto al movimiento. */
function anularPorRpc(id: string, motivo: string, userId: string, mov: Movimiento) {
  if (mov.mesaCambistaId) {
    return supabaseAdmin.rpc('anular_transferencia_mesa_cambio', { p_movimiento_id: id, p_motivo: motivo, p_usuario: userId });
  }
  if (mov.comisionBancaria != null) {
    return supabaseAdmin.rpc('anular_movimiento_con_comision_bancaria', { p_id: id, p_motivo: motivo, p_usuario: userId });
  }
  return supabaseAdmin.rpc('anular_movimiento_banca', { p_id: id, p_motivo: motivo, p_usuario: userId });
}

/**
 * Anula un movimiento de banca manual (ingreso, egreso o transferencia) con llave de edición:
 * revierte el saldo de la(s) banca(s) y marca la fila (nunca se borra). Los movimientos que
 * pertenecen a un pago/cobro se anulan por el pago.
 *
 * Anular una transferencia con cambista revierte además sus asientos en la mesa de cambio, así que exige
 * `opciones.puedeMesaCambio` (permiso mesa_cambio:ver, el mismo que pide completarla). Por defecto es false: falla cerrado.
 */
export async function anularMovimientoBanca(
  id: string,
  motivo: string,
  actor: ActorEdicion,
  opciones: { puedeMesaCambio?: boolean } = {}
): Promise<ResultadoMovimientoEdicion | ErrorTransaccion> {
  const antes = await cargarMovimientoManual(id);
  if ('error' in antes) return antes;
  if (antes.mesaCambistaId && !opciones.puedeMesaCambio) return { error: MSG_ANULAR_MESA_SIN_PERMISO, codigo: 403 };

  const auth = await autorizarEdicion(actor, 'movimiento_banca', id);
  if (!auth.ok) return { error: auth.error, codigo: auth.codigo };

  const { error } = await anularPorRpc(id, motivo, actor.userId, antes);
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
  if (antes.mesaCambistaId && esEdicionContableMovimiento(input)) return { error: MSG_MESA_SIN_CAMBIOS_CONTABLES, codigo: 409 };
  if (antes.comisionBancaria != null && esEdicionContableMovimiento(input)) return { error: MSG_COMISION_SIN_CAMBIOS_CONTABLES, codigo: 409 };

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
