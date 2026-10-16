import { supabaseAdmin } from '../config/supabase.js';
import { MENSAJE_ERROR_GENERICO, esMensajeDeNegocio } from '../utils/errores-bd.js';
import { esColumnaInexistente } from '../utils/migracion-pendiente.js';
import { esFuncionInexistente } from '../utils/transaccion-edicion.js';
import { aplicaComisionBancaria, planificarComisionBancaria } from '../utils/comision-bancaria.js';
import { logger } from '../utils/logger.js';
import { crearMovimiento, obtenerMovimiento, type Movimiento } from './banca-service.js';
import { registrarAuditoria } from './auditoria-service.js';
import { aplicarCategoriaAComisiones } from './comision-categoria-service.js';
import type { CrearMovimientoInput } from '../schemas/cochinito.js';

/**
 * Registro de movimientos de Wallet con comisión bancaria opcional (0.3%, mínimo 14 Bs) cuando se debita una
 * cuenta en bolívares. El movimiento y su cargo de comisión se crean en UNA transacción SQL
 * (docs/migration_wallet_comision_bancaria.sql); aquí solo se decide si aplica, se valida y se traducen errores.
 * Sin la migración, todo se registra como siempre y la comisión no se ofrece.
 */

export const MENSAJE_COMISION_PENDIENTE =
  'La comisión bancaria aún no está habilitada en la base de datos (falta aplicar migration_wallet_comision_bancaria.sql). Registra el movimiento sin comisión o aplica la migración.';
const MENSAJE_SOLO_SALIDAS = 'La comisión bancaria solo aplica a egresos y transferencias.';
const MENSAJE_SOLO_BS = 'La comisión bancaria solo aplica cuando la cuenta de origen está en bolívares (Bs).';
const MENSAJE_ELEGIR = 'Indica si el movimiento lleva comisión bancaria del 0.3%.';
const MENSAJE_SIN_LECTURA = 'El movimiento se registró, pero no se pudo leer de vuelta. Actualiza la pantalla.';
const MENSAJE_SIN_AUDITORIA =
  'El movimiento se registró sin comisión bancaria, pero no se pudo dejar constancia en el historial de auditoría. Avisa al administrador.';
const MENSAJE_COMPROBANTE = 'El movimiento se registró, pero no se pudo adjuntar el comprobante. Adjúntalo editando el movimiento.';

type Fallo = { error: string; codigo: number };

export interface MovimientoRegistrado {
  movimiento: Movimiento;
  /** Cargo de comisión creado junto al movimiento; null si no lleva. */
  comision: { monto: number; movimientoId: string } | null;
  advertencia?: string;
}

const fallo = (codigo: number, error: string): Fallo => ({ error, codigo });

/** ¿Está aplicada la migración? Solo "columna inexistente" cuenta como pendiente; otro error no oculta la opción. */
export async function comisionBancariaDisponible(): Promise<boolean> {
  const { error } = await supabaseAdmin.from('movimientos').select('comision_bancaria').limit(1);
  return !esColumnaInexistente(error, 'comision_bancaria');
}

async function leerOrigen(bancaId: string): Promise<{ moneda: string; saldo: number } | null> {
  const { data } = await supabaseAdmin.from('bancas').select('moneda, saldo').eq('id', bancaId).maybeSingle();
  const fila = data as { moneda?: string; saldo?: number | string } | null;
  return fila?.moneda ? { moneda: fila.moneda, saldo: Number(fila.saldo ?? 0) } : null;
}

async function sinComision(input: CrearMovimientoInput, userId: string): Promise<MovimientoRegistrado | Fallo> {
  const r = await crearMovimiento(input, userId);
  return 'error' in r ? fallo(400, r.error) : { movimiento: r.movimiento, comision: null };
}

function falloDeRpc(error: { code?: string; message?: string }): Fallo {
  if (esFuncionInexistente(error)) return fallo(503, MENSAJE_COMISION_PENDIENTE);
  if (esMensajeDeNegocio(error)) return fallo(409, error.message as string);
  logger.error({ evento: 'movimiento_comision_rpc_fallida', code: error.code, mensaje: error.message });
  return fallo(500, MENSAJE_ERROR_GENERICO);
}

/** Adjunta los comprobantes con un update aparte (el tipo de la columna varía entre despliegues). */
async function adjuntarComprobantes(movimientoId: string, comprobantes: string[]): Promise<string | undefined> {
  if (comprobantes.length === 0) return undefined;
  const { error } = await supabaseAdmin.from('movimientos').update({ comprobantes }).eq('id', movimientoId);
  if (!error) return undefined;
  logger.error({ evento: 'movimiento_comision_comprobante_fallido', movimientoId, mensaje: error.message });
  return MENSAJE_COMPROBANTE;
}

async function conComision(input: CrearMovimientoInput, userId: string): Promise<MovimientoRegistrado | Fallo> {
  const { data, error } = await supabaseAdmin.rpc('crear_movimiento_con_comision_bancaria', {
    p_tipo: input.tipo, p_banca_origen_id: input.bancaId, p_banca_destino_id: input.bancaDestinoId ?? null,
    p_monto: input.monto, p_monto_destino: input.montoDestino ?? null, p_descripcion: input.descripcion,
    p_referencia: input.referencia, p_fecha: input.fecha, p_proveedor_id: input.proveedorId ?? null,
    p_cliente_id: input.clienteId ?? null, p_usuario: userId,
  });
  if (error) return falloDeRpc(error);

  const r = (data ?? {}) as Record<string, unknown>;
  const movimientoId = String(r.movimientoId ?? '');
  const avisoComprobante = await adjuntarComprobantes(movimientoId, input.comprobantes);
  // El cargo de la comisión lleva siempre la categoría COMISIONES BANCARIAS (la BD también lo impone).
  const categoria = await aplicarCategoriaAComisiones(r.comisionId ? [String(r.comisionId)] : []);
  const advertencia = avisoComprobante ?? categoria.advertencia;
  const movimiento = await obtenerMovimiento(movimientoId);
  if (!movimiento) return fallo(500, MENSAJE_SIN_LECTURA);
  return {
    movimiento,
    comision: { monto: Number(r.comision ?? 0), movimientoId: String(r.comisionId ?? '') },
    ...(advertencia ? { advertencia } : {}),
  };
}

/**
 * Omitir la comisión de una salida desde una cuenta en Bs es una decisión de la persona y queda auditada:
 * quién y qué movimiento (sin importes, cuentas ni textos libres). Si no se puede auditar, el movimiento ya
 * existe: se avisa con una advertencia en vez de fallar.
 */
async function sinComisionAuditada(input: CrearMovimientoInput, userId: string): Promise<MovimientoRegistrado | Fallo> {
  const r = await sinComision(input, userId);
  if ('error' in r) return r;
  const auditada = await registrarAuditoria({
    entidadTipo: 'movimiento_banca',
    entidadId: r.movimiento.id,
    accion: 'sin_comision_bancaria',
    usuarioId: userId,
    cambios: { comision_bancaria: { antes: 'aplicaba (0.3%, mínimo 14 Bs)', despues: 'omitida por la persona' } },
  });
  if (auditada) return r;
  logger.warn({ evento: 'movimiento_sin_comision_sin_auditoria', movimientoId: r.movimiento.id, userId });
  return { ...r, advertencia: MENSAJE_SIN_AUDITORIA };
}

/** Qué hacer con un movimiento de salida desde una cuenta en Bs según la elección de la persona. */
async function registrarDesdeBs(
  input: CrearMovimientoInput, userId: string, saldo: number
): Promise<MovimientoRegistrado | Fallo> {
  if (input.llevaComision === false) return sinComisionAuditada(input, userId);
  if (input.llevaComision === undefined) {
    return (await comisionBancariaDisponible()) ? fallo(400, MENSAJE_ELEGIR) : sinComision(input, userId);
  }
  const plan = planificarComisionBancaria({ tipo: input.tipo, moneda: 'VES', monto: input.monto, lleva: true, saldo });
  if (!plan.ok) return fallo(409, plan.error);
  return conComision(input, userId);
}

/** Registra un movimiento manual de Wallet; aplica la comisión bancaria cuando corresponde y la persona la eligió. */
export async function registrarMovimiento(
  input: CrearMovimientoInput,
  userId: string
): Promise<MovimientoRegistrado | Fallo> {
  if (input.tipo === 'ingreso') {
    return input.llevaComision === true ? fallo(400, MENSAJE_SOLO_SALIDAS) : sinComision(input, userId);
  }
  const origen = await leerOrigen(input.bancaId);
  // Cuenta ilegible: el registro normal informa el problema real (cuenta inexistente, etc.).
  if (!origen) return sinComision(input, userId);
  if (!aplicaComisionBancaria(input.tipo, origen.moneda)) {
    return input.llevaComision === true ? fallo(400, MENSAJE_SOLO_BS) : sinComision(input, userId);
  }
  return registrarDesdeBs(input, userId, origen.saldo);
}
