import { supabaseAdmin } from '../config/supabase.js';
import type { RegistrarPagoInput, RegistrarPagoMultipleInput } from '../schemas/pagos.js';
import { notificarPago } from './telegram-eventos-service.js';
import { logger } from '../utils/logger.js';
import { ejecutarEnSegundoPlano } from '../utils/segundo-plano.js';
import { aplicarCategoriaAMovimientos, categoriaFijaDePago } from './pago-categoria-service.js';
import {
  aplicarComisionesDePago, validarEleccionComisionPago, type ComisionPagoCreada, type LineaComisionPago,
} from './pago-comision-service.js';

/** Une advertencias de pasos independientes (categoría, comisión) en una sola, sin repetir. */
function unirAdvertencias(...avisos: Array<string | undefined>): string | undefined {
  const unicos = [...new Set(avisos.filter((a): a is string => !!a))];
  return unicos.length > 0 ? unicos.join(' ') : undefined;
}

/** Guarda las fotos del comprobante en el movimiento. El pago ya quedó registrado antes
 *  de llamar esto — si guardarlas falla, no se deshace el pago, solo se loguea. La plata
 *  ya se movió, es lo que importa. */
async function adjuntarComprobante(movimientoId: string, comprobantes: string[]): Promise<void> {
  const { error } = await supabaseAdmin
    .from('movimientos')
    .update({ comprobantes })
    .eq('id', movimientoId);

  if (error) logger.error({ evento: 'pago_comprobante_no_guardado', mensaje: error.message, movimientoId });
}

/** Un movimiento suelto pertenece a un grupo de operación (o es su propio grupo si es legacy). */
async function grupoDeMovimiento(movimientoId: string): Promise<string> {
  const { data } = await supabaseAdmin.from('movimientos').select('grupo_id').eq('id', movimientoId).maybeSingle();
  return (data as { grupo_id: string | null } | null)?.grupo_id ?? movimientoId;
}

interface PostRegistro {
  movimientoIds: string[];
  grupoId: string | null;
  categoriaId: string | null;
  lineas: LineaComisionPago[];
  usuarioId: string;
}

/**
 * Pasos posteriores al registro del dinero (ya no se deshacen): categoría fija de los movimientos del pago y
 * comisión bancaria de las cuentas en Bs. Devuelve las comisiones creadas y una advertencia unificada.
 */
async function completarPago(p: PostRegistro): Promise<{ comisiones: ComisionPagoCreada[]; advertencia?: string }> {
  const categoria = await aplicarCategoriaAMovimientos(p.movimientoIds, p.categoriaId);
  const comision = await aplicarComisionesDePago({
    movimientoIds: p.movimientoIds, grupoId: p.grupoId, lineas: p.lineas, usuarioId: p.usuarioId,
  });
  const advertencia = unirAdvertencias(categoria.advertencia, comision.advertencia);
  return { comisiones: comision.comisiones, ...(advertencia ? { advertencia } : {}) };
}

export async function registrarPago(
  input: RegistrarPagoInput,
  registradoPor: string
): Promise<{ movimientoId: string; comision?: ComisionPagoCreada; advertencia?: string } | { error: string }> {
  const lineas: LineaComisionPago[] = [{ bancaId: input.bancaId, moneda: input.moneda, llevaComision: input.llevaComision }];
  const rechazo = await validarEleccionComisionPago(lineas);
  if (rechazo) return { error: rechazo };

  const categoriaId = await categoriaFijaDePago();
  const { data, error } = await supabaseAdmin.rpc('registrar_pago_proveedor', {
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
  });

  if (error || !data) return { error: error?.message ?? 'No se pudo registrar el pago.' };
  const movimientoId = data as string;

  if (input.comprobantes.length > 0) await adjuntarComprobante(movimientoId, input.comprobantes);
  // El grupo solo hace falta de inmediato para auditar la comisión de una cuenta en Bs; Telegram lo resuelve en segundo plano.
  const grupoBs = input.moneda === 'VES' ? await grupoDeMovimiento(movimientoId) : null;
  const { comisiones, advertencia } = await completarPago({
    movimientoIds: [movimientoId], grupoId: grupoBs, categoriaId, lineas, usuarioId: registradoPor,
  });
  // Telegram (fire-and-forget): comprobante PDF del pago + fotos del comprobante bancario.
  ejecutarEnSegundoPlano(
    (grupoBs ? Promise.resolve(grupoBs) : grupoDeMovimiento(movimientoId))
      .then(grupoId => notificarPago('proveedor', input.proveedorId, grupoId, { comprobantes: input.comprobantes }))
      .catch(err => logger.error({ evento: 'pago_telegram_error', mensaje: err instanceof Error ? err.message : String(err) })),
    'pago_telegram'
  );

  return { movimientoId, ...(comisiones[0] ? { comision: comisiones[0] } : {}), ...(advertencia ? { advertencia } : {}) };
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
  /** Se informa si el pago quedó registrado pero no se pudo asignar la categoría o cargar la comisión. */
  advertencia?: string;
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
  const lineas: LineaComisionPago[] = input.bancas.map(b => ({ bancaId: b.bancaId, moneda: b.moneda, llevaComision: b.llevaComision }));
  const rechazo = await validarEleccionComisionPago(lineas);
  if (rechazo) return { error: rechazo };

  // La categoría fija solo aplica si hay movimiento de dinero (un cruce puro no lo tiene).
  const categoriaId = input.bancas.length > 0 ? await categoriaFijaDePago() : null;
  const { data, error } = await supabaseAdmin.rpc('registrar_pago_proveedor_multi_banca', {
    p_proveedor_id: input.proveedorId,
    p_bancas: input.bancas.map(b => ({ bancaId: b.bancaId, monto: b.monto, montoUsd: b.montoUsd, moneda: b.moneda, referencia: b.referencia ?? null })),
    p_monto_usd: input.montoUsd,
    p_descripcion: input.descripcion,
    p_referencia: input.referencia,
    p_fecha: input.fecha,
    p_registrado_por: registradoPor,
    p_items: input.items.map(i => ({ tipo: i.tipo, id: i.id, montoUsd: i.montoUsd })),
  });

  if (error || !data) return { error: error?.message ?? 'No se pudo registrar el pago.' };
  const creado = data as Omit<ResultadoPagoMulti, 'categoriaId' | 'comisiones' | 'advertencia'>;

  if (input.comprobantes.length > 0 && creado.movimientoPrincipalId) {
    await adjuntarComprobante(creado.movimientoPrincipalId, input.comprobantes);
  }
  const { comisiones, advertencia } = await completarPago({
    movimientoIds: creado.movimientoIds ?? [], grupoId: creado.grupoId, categoriaId, lineas, usuarioId: registradoPor,
  });
  const resultado: ResultadoPagoMulti = { ...creado, categoriaId, comisiones, ...(advertencia ? { advertencia } : {}) };
  // Telegram (fire-and-forget): comprobante del pago/adelanto o del cruce puro (sin dinero).
  notificarPago('proveedor', input.proveedorId, resultado.grupoId, {
    comprobantes: resultado.movimientoPrincipalId ? input.comprobantes : [],
    esCruce: resultado.movimientoPrincipalId === null,
  });

  return resultado;
}
