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
  yaCompletada: boolean;
  montoAcreditado: number;
}

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

/** Completa una transferencia en proceso: acredita el destino (neto de comisión). Repetirla no vuelve a acreditar. */
export async function completarTransferenciaMesa(
  movimientoId: string,
  userId: string
): Promise<TransferenciaMesaCompletada | Fallo> {
  const { data, error } = await supabaseAdmin.rpc('completar_transferencia_mesa_cambio', {
    p_movimiento_id: movimientoId, p_usuario: userId,
  });
  if (error) return fallaDeRpcMesa(error, 'completar');
  const r = (data ?? {}) as Record<string, unknown>;
  const movimiento = await obtenerMovimiento(movimientoId);
  if (!movimiento) return { error: MENSAJE_SIN_LECTURA, codigo: 500 };
  return { movimiento, yaCompletada: Boolean(r.yaCompletada), montoAcreditado: numeroDe(r.montoAcreditado) };
}
