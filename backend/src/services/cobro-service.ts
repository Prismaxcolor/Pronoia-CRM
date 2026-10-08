import { supabaseAdmin } from '../config/supabase.js';
import type { RegistrarCobroMultipleInput } from '../schemas/cobros.js';
import { notificarPago } from './telegram-eventos-service.js';
import { logger } from '../utils/logger.js';

/** Espejo de pago-service.ts (registrarPagoMultiple) para cobros a cliente —
 *  ver nota en nota-ajuste-cliente-service.ts sobre por qué es un archivo
 *  aparte en vez de generalizar el de proveedor. */

async function adjuntarComprobante(movimientoId: string, comprobantes: string[]): Promise<void> {
  const { error } = await supabaseAdmin
    .from('movimientos')
    .update({ comprobantes })
    .eq('id', movimientoId);

  if (error) logger.error({ evento: 'cobro_comprobante_no_guardado', mensaje: error.message, movimientoId });
}

interface ResultadoCobroMulti {
  /** Null en un cruce puro (efectivo = 0): no hay movimiento de dinero. */
  movimientoPrincipalId: string | null;
  movimientoIds: string[];
  grupoId: string;
  numeroCobro: number | null;
  numeroAnticipo: number | null;
  /** Correlativo CRV- cuando la operación fue un cruce puro, sin movimiento de dinero. */
  numeroCruce: number | null;
}

/** Cobro combinado ("Registrar cobro"): repartido entre una o varias bancas
 *  de destino, liquida varias facturas de venta y/o notas de débito a la
 *  vez. El excedente queda como anticipo, en un movimiento aparte con su
 *  propio correlativo (lo separa la RPC). */
export async function registrarCobroMultiple(
  input: RegistrarCobroMultipleInput,
  registradoPor: string
): Promise<ResultadoCobroMulti | { error: string }> {
  const { data, error } = await supabaseAdmin.rpc('registrar_cobro_cliente_multi_banca', {
    p_cliente_id: input.clienteId,
    p_bancas: input.bancas.map(b => ({ bancaId: b.bancaId, monto: b.monto, montoUsd: b.montoUsd, moneda: b.moneda, referencia: b.referencia ?? null })),
    p_monto_usd: input.montoUsd,
    p_descripcion: input.descripcion,
    p_referencia: input.referencia,
    p_fecha: input.fecha,
    p_registrado_por: registradoPor,
    p_items: input.items.map(i => ({ tipo: i.tipo, id: i.id, montoUsd: i.montoUsd })),
  });

  if (error || !data) return { error: error?.message ?? 'No se pudo registrar el cobro.' };
  const resultado = data as ResultadoCobroMulti;

  if (input.comprobantes.length > 0 && resultado.movimientoPrincipalId) {
    await adjuntarComprobante(resultado.movimientoPrincipalId, input.comprobantes);
  }
  // Telegram (fire-and-forget): comprobante del cobro/anticipo o del cruce puro (sin dinero).
  notificarPago('cliente', input.clienteId, resultado.grupoId, {
    comprobantes: resultado.movimientoPrincipalId ? input.comprobantes : [],
    esCruce: resultado.movimientoPrincipalId === null,
  });

  return resultado;
}
