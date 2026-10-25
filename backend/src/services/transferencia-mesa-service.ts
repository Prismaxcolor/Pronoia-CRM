import { supabaseAdmin } from '../config/supabase.js';
import { esMensajeDeNegocio, MENSAJE_ERROR_GENERICO } from '../utils/errores-bd.js';
import { esFuncionInexistente } from '../utils/transaccion-edicion.js';
import { planificarTransferenciaMesa } from '../utils/mesa-cambio-transferencia.js';
import { logger } from '../utils/logger.js';
import { obtenerMovimiento, type Movimiento } from './banca-service.js';
import type { CrearTransferenciaMesaInput } from '../schemas/transferencia-mesa.js';

/**
 * Transferencias entre cuentas/cajas de Wallet con mesa de cambio. La contabilidad (saldos, asientos del
 * cambista, estados) vive en las RPC SQL de docs/migration_mesa_cambio_transferencias.sql; aquí solo se
 * validan los datos de entrada, se llama a la RPC y se traducen sus errores.
 */

type Fallo = { error: string; codigo: number };
type ErrorRpc = { code?: string; message?: string } | null;

export const MENSAJE_MESA_TRANSFERENCIAS_PENDIENTE =
  'Las transferencias con mesa de cambio aún no están habilitadas en la base de datos (falta aplicar migration_mesa_cambio_transferencias.sql).';
export const MENSAJE_COBRO_PARCIAL_PENDIENTE =
  'El cobro parcial aún no está habilitado en la base de datos (falta aplicar migration_mesa_cambio_cobro_parcial.sql).';
const MENSAJE_FOTO_COBRO = 'El cobro se registró, pero no se pudo adjuntar la foto. Adjúntala editando el movimiento.';
const MENSAJE_OBSERVACION = 'El cobro se registró, pero no se pudo guardar la observación (falta aplicar migration_mesa_cambio_observacion.sql).';
const MENSAJE_SIN_LECTURA = 'La transferencia se registró, pero no se pudo leer de vuelta. Actualiza la pantalla.';
const MENSAJE_COMPROBANTE = 'La transferencia se registró, pero no se pudo adjuntar el comprobante. Adjúntalo editando el movimiento.';

export interface TransferenciaMesaCreada {
  movimiento: Movimiento;
  asientoId: string;
  asientoNumero: number;
  montoUsd: number;
  comision: number;
  montoNeto: number;
  advertencia?: string;
}

export interface TransferenciaMesaCompletada {
  movimiento: Movimiento;
  /** La transferencia ya estaba cobrada por completo: esta llamada no acreditó nada. */
  yaCompletada: boolean;
  /** true si tras este cobro no queda pendiente (estado 'completada'). */
  completada: boolean;
  /** Acreditado al destino en ESTA llamada (neto de comisión, moneda destino). */
  montoAcreditado: number;
  /** Total cobrado hasta ahora y lo que falta por cobrar (moneda destino). */
  montoCobrado: number;
  montoPendiente: number;
  advertencia?: string;
}

/** Opciones de un cobro: sin ellas se cobra todo lo pendiente, sin foto (comportamiento anterior). */
export interface OpcionesCobroMesa {
  /** Neto a cobrar ahora; null = todo lo pendiente. */
  montoCobrado: number | null;
  /** Pendiente que vio el usuario: si cambió, el cobro se rechaza. */
  pendienteEsperado: number | null;
  /** Fotos del comprobante del cobro (se agregan a las del movimiento). */
  comprobantes: string[];
  /** Nota de quien cobra; se agrega a las observaciones del movimiento. Opcional: los llamadores anteriores no la envían. */
  observacion?: string | null;
}

const COBRO_TOTAL_SIN_FOTO: OpcionesCobroMesa = { montoCobrado: null, pendienteEsperado: null, comprobantes: [] };

/** Función inexistente => 503; `raise exception` de negocio => 409 con su texto; el resto, 500 genérico (sin detalles de BD). */
export function fallaDeRpcMesa(error: NonNullable<ErrorRpc>, contexto: string): Fallo {
  if (esFuncionInexistente(error)) return { error: MENSAJE_MESA_TRANSFERENCIAS_PENDIENTE, codigo: 503 };
  if (esMensajeDeNegocio(error)) return { error: error.message as string, codigo: 409 };
  logger.error({ evento: 'transferencia_mesa_rpc_fallida', contexto, code: error.code, mensaje: error.message });
  return { error: MENSAJE_ERROR_GENERICO, codigo: 500 };
}

interface FilaBanca {
  id: string;
  moneda: string;
  saldo: number;
  archivada: boolean;
}

async function leerBancas(origenId: string, destinoId: string): Promise<{ origen: FilaBanca; destino: FilaBanca } | Fallo> {
  const { data, error } = await supabaseAdmin.from('bancas').select('id, moneda, saldo, archivada').in('id', [origenId, destinoId]);
  if (error || !data) return { error: 'No se pudieron leer las cuentas. Inténtalo de nuevo.', codigo: 500 };
  const filas = (data as Array<Record<string, unknown>>).map((f): FilaBanca => ({
    id: f.id as string, moneda: f.moneda as string, saldo: Number(f.saldo), archivada: Boolean(f.archivada),
  }));
  const origen = filas.find(f => f.id === origenId);
  const destino = filas.find(f => f.id === destinoId);
  if (!origen || !destino) return { error: 'Cuenta no encontrada.', codigo: 404 };
  if (origen.archivada || destino.archivada) return { error: 'No se puede transferir con una cuenta archivada.', codigo: 409 };
  return { origen, destino };
}

const numeroDe = (v: unknown): number => Number(v ?? 0);

/** Adjunta los comprobantes con un update aparte (el tipo de la columna varía entre despliegues). */
async function adjuntarComprobantes(movimientoId: string, comprobantes: string[]): Promise<string | undefined> {
  if (comprobantes.length === 0) return undefined;
  const { error } = await supabaseAdmin.from('movimientos').update({ comprobantes }).eq('id', movimientoId);
  if (!error) return undefined;
  logger.error({ evento: 'transferencia_mesa_comprobante_fallido', movimientoId, mensaje: error.message });
  return MENSAJE_COMPROBANTE;
}

/** Crea la transferencia EN PROCESO (descuenta el origen, no acredita el destino) y la deuda del cambista. */
export async function crearTransferenciaMesa(
  input: CrearTransferenciaMesaInput,
  userId: string
): Promise<{ transferencia: TransferenciaMesaCreada } | Fallo> {
  const bancas = await leerBancas(input.bancaId, input.bancaDestinoId);
  if ('error' in bancas) return bancas;
  const plan = planificarTransferenciaMesa({
    monedaOrigen: bancas.origen.moneda, monedaDestino: bancas.destino.moneda, monto: input.monto,
    montoDestino: input.montoDestino, montoUsdManual: input.montoUsd, saldoOrigen: bancas.origen.saldo, comision: input.comision,
  });
  if (!plan.ok) return { error: plan.error, codigo: 400 };

  const { data, error } = await supabaseAdmin.rpc('crear_transferencia_mesa_cambio', {
    p_cambista_id: input.cambistaId, p_banca_origen_id: input.bancaId, p_banca_destino_id: input.bancaDestinoId,
    p_monto: input.monto, p_monto_destino: input.montoDestino, p_monto_usd: input.montoUsd,
    p_comision_modo: input.comision?.modo ?? null, p_comision_valor: input.comision?.valor ?? null,
    p_descripcion: input.descripcion, p_referencia: input.referencia, p_fecha: input.fecha, p_usuario: userId,
  });
  if (error) return fallaDeRpcMesa(error, 'crear');

  const r = (data ?? {}) as Record<string, unknown>;
  const movimientoId = String(r.movimientoId ?? '');
  const advertencia = await adjuntarComprobantes(movimientoId, input.comprobantes);
  const movimiento = await obtenerMovimiento(movimientoId);
  if (!movimiento) return { error: MENSAJE_SIN_LECTURA, codigo: 500 };
  return {
    transferencia: {
      movimiento, asientoId: String(r.asientoId ?? ''), asientoNumero: numeroDe(r.asientoNumero),
      montoUsd: numeroDe(r.montoUsd), comision: numeroDe(r.comision), montoNeto: numeroDe(r.montoNeto),
      ...(advertencia ? { advertencia } : {}),
    },
  };
}

/** Agrega las fotos a las que ya tiene el movimiento (sin duplicar). Update aparte: el tipo de la columna varía. */
async function agregarComprobantes(movimientoId: string, nuevos: string[]): Promise<string | undefined> {
  if (nuevos.length === 0) return undefined;
  const { data, error: errLectura } = await supabaseAdmin.from('movimientos').select('comprobantes').eq('id', movimientoId).maybeSingle();
  if (errLectura) return registrarFalloFoto(movimientoId, errLectura.message);
  const previos = Array.isArray(data?.comprobantes) ? (data.comprobantes as string[]) : [];
  const unidos = [...new Set([...previos, ...nuevos])];
  const { error } = await supabaseAdmin.from('movimientos').update({ comprobantes: unidos }).eq('id', movimientoId);
  return error ? registrarFalloFoto(movimientoId, error.message) : undefined;
}

function registrarFalloFoto(movimientoId: string, mensaje: string): string {
  logger.error({ evento: 'transferencia_mesa_foto_cobro_fallida', movimientoId, mensaje });
  return MENSAJE_FOTO_COBRO;
}

/** Agrega la observación a las que ya tiene el movimiento (una línea por cobro). Sin la columna avisa, no falla el cobro. */
async function agregarObservacion(movimientoId: string, observacion: string | null | undefined): Promise<string | undefined> {
  if (!observacion) return undefined;
  const falla = (mensaje: string): string => {
    logger.error({ evento: 'transferencia_mesa_observacion_fallida', movimientoId, mensaje });
    return MENSAJE_OBSERVACION;
  };
  const { data, error: errLectura } = await supabaseAdmin.from('movimientos').select('mesa_observacion').eq('id', movimientoId).maybeSingle();
  if (errLectura) return falla(errLectura.message);
  const previa = typeof data?.mesa_observacion === 'string' ? data.mesa_observacion : '';
  const unida = previa ? `${previa}\n${observacion}` : observacion;
  const { error } = await supabaseAdmin.from('movimientos').update({ mesa_observacion: unida }).eq('id', movimientoId);
  return error ? falla(error.message) : undefined;
}

type RespuestaRpc ={ data: unknown; error: NonNullable<ErrorRpc> | null };

/** Cobra con la RPC nueva; si aún no existe y el cobro es total, usa la anterior (que acredita todo el neto). */
async function cobrarPorRpc(movimientoId: string, userId: string, o: OpcionesCobroMesa): Promise<RespuestaRpc | Fallo> {
  const nueva = await supabaseAdmin.rpc('cobrar_transferencia_mesa_cambio', {
    p_movimiento_id: movimientoId, p_monto: o.montoCobrado, p_pendiente_esperado: o.pendienteEsperado, p_usuario: userId,
  });
  if (!nueva.error || !esFuncionInexistente(nueva.error)) return nueva;
  if (o.montoCobrado !== null) return { error: MENSAJE_COBRO_PARCIAL_PENDIENTE, codigo: 503 };
  return supabaseAdmin.rpc('completar_transferencia_mesa_cambio', { p_movimiento_id: movimientoId, p_usuario: userId });
}

/**
 * Cobra una transferencia en proceso: acredita al destino el monto cobrado (neto de comisión) y salda esa parte
 * de la deuda del cambista. Sin monto cobra todo lo pendiente; con menos queda en 'parcial' y se puede cobrar el
 * resto después. Repetir el cobro total no vuelve a acreditar. La foto es opcional.
 */
export async function completarTransferenciaMesa(
  movimientoId: string,
  userId: string,
  opciones: OpcionesCobroMesa = COBRO_TOTAL_SIN_FOTO
): Promise<TransferenciaMesaCompletada | Fallo> {
  const resp = await cobrarPorRpc(movimientoId, userId, opciones);
  if ('codigo' in resp) return resp;
  if (resp.error) return fallaDeRpcMesa(resp.error, 'completar');
  const r = (resp.data ?? {}) as Record<string, unknown>;
  const advertencias = [
    await agregarComprobantes(movimientoId, opciones.comprobantes),
    // Un reintento o doble clic ("ya completada") no cobró nada: no se repite la nota.
    r.yaCompletada ? undefined : await agregarObservacion(movimientoId, opciones.observacion),
  ].filter((a): a is string => a !== undefined);
  const advertencia = advertencias.length > 0 ? advertencias.join(' ') : undefined;
  const movimiento = await obtenerMovimiento(movimientoId);
  if (!movimiento) return { error: MENSAJE_SIN_LECTURA, codigo: 500 };
  const completada = r.completada === undefined ? movimiento.mesaEstado === 'completada' : Boolean(r.completada);
  return {
    movimiento, yaCompletada: Boolean(r.yaCompletada), completada, montoAcreditado: numeroDe(r.montoAcreditado),
    montoCobrado: numeroDe(r.montoCobrado ?? movimiento.mesaMontoCobrado), montoPendiente: numeroDe(r.montoPendiente),
    ...(advertencia ? { advertencia } : {}),
  };
}
