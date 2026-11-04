import { supabaseAdmin } from '../config/supabase.js';
import type { RegistrarPagoInput, RegistrarPagoMultipleInput } from '../schemas/pagos.js';
import { notificarPago } from './telegram-eventos-service.js';
import { logger } from '../utils/logger.js';
import { ejecutarEnSegundoPlano } from '../utils/segundo-plano.js';
import { categoriaDelPago } from './pago-categoria-service.js';
import {
  conComisionAutomatica, lineaCargaComision, validarEleccionComisionPago, type ComisionPagoCreada,
} from './pago-comision-service.js';
import { ComisionAutomaticaNoDisponibleError } from './comision-automatica-service.js';
import { registrarConPasos, type IdsRegistro } from './pago-registro-comun.js';
import { advertenciaDePasos } from './pagos-pasos-service.js';
import { validarMontosDeLineas } from './montos-pago-service.js';

type Lineas = Awaited<ReturnType<typeof conComisionAutomatica>>;

/** Marca la comisión automática de las cuentas; si no se puede verificar falla cerrado (el pago no se registra). */
async function lineasConComision(entrada: Parameters<typeof conComisionAutomatica>[0]): Promise<Lineas | { error: string }> {
  try {
    return await conComisionAutomatica(entrada);
  } catch (e) {
    if (e instanceof ComisionAutomaticaNoDisponibleError) return { error: e.message };
    throw e;
  }
}

/** Un movimiento suelto pertenece a un grupo de operación (o es su propio grupo si es legacy). */
async function grupoDeMovimiento(movimientoId: string): Promise<string> {
  const { data } = await supabaseAdmin.from('movimientos').select('grupo_id').eq('id', movimientoId).maybeSingle();
  return (data as { grupo_id: string | null } | null)?.grupo_id ?? movimientoId;
}

/** La RPC original devuelve el id del movimiento; el envoltorio, {movimientoId, grupoId}. El grupo solo hace falta
 *  de inmediato para auditar/cargar la comisión de una cuenta en Bs; Telegram lo resuelve en segundo plano. */
async function normalizarPagoUnico(
  data: unknown, viaEnvoltorio: boolean, esBs: boolean
): Promise<{ creado: Record<string, unknown>; ids: IdsRegistro }> {
  const d = data as { movimientoId?: string; grupoId?: string };
  const movimientoId = viaEnvoltorio ? String(d.movimientoId) : String(data);
  const grupoId = viaEnvoltorio ? (d.grupoId ?? null) : esBs ? await grupoDeMovimiento(movimientoId) : null;
  return { creado: { movimientoId }, ids: { movimientoIds: [movimientoId], principalId: movimientoId, grupoId } };
}

/** Pago a proveedor desde una sola banca. Con `clientRequestId` los reintentos los deduplica la ruta (operaciones_cliente)
 *  y, si la migración de idempotencia está aplicada, también la base de datos. */
export async function registrarPago(
  input: RegistrarPagoInput,
  registradoPor: string
): Promise<{ movimientoId: string; comision?: ComisionPagoCreada; advertencia?: string } | { error: string }> {
  const lineas = await lineasConComision([{ bancaId: input.bancaId, moneda: input.moneda, llevaComision: input.llevaComision }]);
  if ('error' in lineas) return lineas;
  const rechazo = (await validarEleccionComisionPago(lineas))
    ?? (await validarMontosDeLineas([{ monto: input.monto, montoUsd: input.montoUsd, moneda: input.moneda, tasa: input.tasa }]));
  if (rechazo) return { error: rechazo };

  const categoria = await categoriaDelPago(input.categoriaId);
  if ('error' in categoria) return { error: categoria.error };
  const categoriaId = categoria.categoriaId;
  const r = await registrarConPasos({
    envoltorio: 'registrar_pago_proveedor_completo',
    original: 'registrar_pago_proveedor',
    args: {
      p_proveedor_id: input.proveedorId,
      p_banca_id: input.bancaId,
      p_monto: input.monto,
      p_moneda: input.moneda,
      p_monto_usd: input.montoUsd,
      p_descripcion: input.descripcion,
      p_referencia: input.referencia,
      p_fecha: input.fecha,
      p_registrado_por: registradoPor,
      p_factura_id: input.facturaId ?? null,
    },
    extraEnvoltorio: { p_con_comision: lineaCargaComision(lineas[0]) },
    clientRequestId: input.clientRequestId,
    categoriaId, comprobantes: input.comprobantes, lineas, usuarioId: registradoPor,
    mensajeError: 'No se pudo registrar el pago.',
    normalizar: (data, viaEnvoltorio) => normalizarPagoUnico(data, viaEnvoltorio, input.moneda === 'VES'),
  });
  if ('error' in r) return r;

  const movimientoId = String(r.creado.movimientoId);
  const advertencia = advertenciaDePasos(r.estado);
  // Telegram (fire-and-forget): comprobante PDF del pago + fotos del comprobante bancario.
  ejecutarEnSegundoPlano(
    (r.ids.grupoId ? Promise.resolve(r.ids.grupoId) : grupoDeMovimiento(movimientoId))
      .then(grupoId => notificarPago('proveedor', input.proveedorId, grupoId, { comprobantes: input.comprobantes }))
      .catch(err => logger.error({ evento: 'pago_telegram_error', mensaje: err instanceof Error ? err.message : String(err) })),
    'pago_telegram'
  );

  return { movimientoId, ...(r.estado.comisiones[0] ? { comision: r.estado.comisiones[0] } : {}), ...(advertencia ? { advertencia } : {}) };
}

interface ResultadoPagoMulti {
  /** Null en un cruce puro (efectivo = 0): no hay movimiento de dinero. */
  movimientoPrincipalId: string | null;
  movimientoIds: string[];
  grupoId: string;
  numeroPago: number | null;
  numeroAdelanto: number | null;
  /** Correlativo CR- cuando la operación fue un cruce puro, sin movimiento de dinero. */
  numeroCruce: number | null;
  /** Categoría del Wallet aplicada a los movimientos de dinero (fija para pagos); null si no hay. */
  categoriaId: string | null;
  /** Cargos de comisión bancaria creados (uno por cuenta en Bs donde se eligió Sí). */
  comisiones: ComisionPagoCreada[];
  /** Se informa si el pago quedó registrado pero un paso posterior (categoría, comprobante, comisión) sigue pendiente de reintento. */
  advertencia?: string;
}

type CreadoMulti = Omit<ResultadoPagoMulti, 'categoriaId' | 'comisiones' | 'advertencia'>;

async function normalizarMulti(data: unknown): Promise<{ creado: Record<string, unknown>; ids: IdsRegistro }> {
  const creado = data as CreadoMulti;
  return {
    creado: { ...creado },
    ids: { movimientoIds: creado.movimientoIds ?? [], principalId: creado.movimientoPrincipalId, grupoId: creado.grupoId },
  };
}

/** Pago combinado ("Registrar pago"): repartido entre una o varias bancas de
 *  origen, liquida varias facturas y/o notas de débito a la vez. El
 *  excedente del total sobre la suma de esos ítems queda como adelanto, en
 *  un movimiento aparte con su propio correlativo (lo separa la RPC).
 *  Los adelantos y notas de crédito seleccionados se descuentan del total; si
 *  no queda nada por pagar es un cruce puro (sin bancas, sin movimiento).
 *  Las cuentas en Bs piden elegir si llevan comisión bancaria (0.3%, mínimo 14 Bs). */
export async function registrarPagoMultiple(
  input: RegistrarPagoMultipleInput,
  registradoPor: string
): Promise<ResultadoPagoMulti | { error: string }> {
  const lineas = await lineasConComision(input.bancas.map(b => ({ bancaId: b.bancaId, moneda: b.moneda, llevaComision: b.llevaComision })));
  if ('error' in lineas) return lineas;
  const rechazo = (await validarEleccionComisionPago(lineas))
    ?? (await validarMontosDeLineas(input.bancas.map(b => ({ monto: b.monto, montoUsd: b.montoUsd, moneda: b.moneda, tasa: b.tasa }))));
  if (rechazo) return { error: rechazo };

  // La categoría fija solo aplica si hay movimiento de dinero (un cruce puro no lo tiene).
  const categoria = input.bancas.length > 0 ? await categoriaDelPago(input.categoriaId) : { categoriaId: null };
  if ('error' in categoria) return { error: categoria.error };
  const categoriaId = categoria.categoriaId;
  const r = await registrarConPasos({
    envoltorio: 'registrar_pago_proveedor_multi_banca_completo',
    original: 'registrar_pago_proveedor_multi_banca',
    args: {
      p_proveedor_id: input.proveedorId,
      p_bancas: input.bancas.map(b => ({ bancaId: b.bancaId, monto: b.monto, montoUsd: b.montoUsd, moneda: b.moneda, referencia: b.referencia ?? null })),
      p_monto_usd: input.montoUsd,
      p_descripcion: input.descripcion,
      p_referencia: input.referencia,
      p_fecha: input.fecha,
      p_registrado_por: registradoPor,
      p_items: input.items.map(i => ({ tipo: i.tipo, id: i.id, montoUsd: i.montoUsd })),
    },
    extraEnvoltorio: { p_bancas_con_comision: lineas.filter(lineaCargaComision).map(l => l.bancaId) },
    clientRequestId: input.clientRequestId,
    categoriaId, comprobantes: input.comprobantes, lineas, usuarioId: registradoPor,
    mensajeError: 'No se pudo registrar el pago.',
    normalizar: normalizarMulti,
  });
  if ('error' in r) return r;

  const advertencia = advertenciaDePasos(r.estado);
  const resultado: ResultadoPagoMulti = {
    ...(r.creado as CreadoMulti), categoriaId, comisiones: r.estado.comisiones, ...(advertencia ? { advertencia } : {}),
  };
  // Telegram (fire-and-forget): comprobante del pago/adelanto o del cruce puro (sin dinero).
  notificarPago('proveedor', input.proveedorId, resultado.grupoId, {
    comprobantes: resultado.movimientoPrincipalId ? input.comprobantes : [],
    esCruce: resultado.movimientoPrincipalId === null,
  });

  return resultado;
}
