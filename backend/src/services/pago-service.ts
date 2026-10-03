import { supabaseAdmin } from '../config/supabase.js';
import type { RegistrarPagoInput, RegistrarPagoMultipleInput } from '../schemas/pagos.js';
import { notificarPago } from './telegram-eventos-service.js';
import { logger } from '../utils/logger.js';
import { ejecutarEnSegundoPlano } from '../utils/segundo-plano.js';

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

export async function registrarPago(
  input: RegistrarPagoInput,
  registradoPor: string
): Promise<{ movimientoId: string } | { error: string }> {
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
  // Telegram (fire-and-forget): comprobante PDF del pago + fotos del comprobante bancario.
  ejecutarEnSegundoPlano(
    grupoDeMovimiento(movimientoId)
      .then(grupoId => notificarPago('proveedor', input.proveedorId, grupoId, { comprobantes: input.comprobantes }))
      .catch(err => logger.error({ evento: 'pago_telegram_error', mensaje: err instanceof Error ? err.message : String(err) })),
    'pago_telegram'
  );

  return { movimientoId };
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
}

/** Pago combinado ("Registrar pago"): repartido entre una o varias bancas de
 *  origen, liquida varias facturas y/o notas de débito a la vez. El
 *  excedente del total sobre la suma de esos ítems queda como adelanto, en
 *  un movimiento aparte con su propio correlativo (lo separa la RPC).
 *  Los adelantos y notas de crédito seleccionados se descuentan del total; si
 *  no queda nada por pagar es un cruce puro (sin bancas, sin movimiento). */
export async function registrarPagoMultiple(
  input: RegistrarPagoMultipleInput,
  registradoPor: string
): Promise<ResultadoPagoMulti | { error: string }> {
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
  const resultado = data as ResultadoPagoMulti;

  if (input.comprobantes.length > 0 && resultado.movimientoPrincipalId) {
    await adjuntarComprobante(resultado.movimientoPrincipalId, input.comprobantes);
  }
  // Telegram (fire-and-forget): comprobante del pago/adelanto o del cruce puro (sin dinero).
  notificarPago('proveedor', input.proveedorId, resultado.grupoId, {
    comprobantes: resultado.movimientoPrincipalId ? input.comprobantes : [],
    esCruce: resultado.movimientoPrincipalId === null,
  });

  return resultado;
}
