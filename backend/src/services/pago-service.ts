import { supabaseAdmin } from '../config/supabase.js';
import type { RegistrarPagoInput, RegistrarPagoMultipleInput } from '../schemas/pagos.js';
import { notificarDocumento } from './telegram-notify-service.js';
import { logger } from '../utils/logger.js';

const MIME_POR_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function extension(url: string): string {
  const limpio = url.split('?')[0];
  return limpio.split('.').pop()?.toLowerCase() ?? 'jpg';
}

/** Dispara el envío de un comprobante por Telegram (fire-and-forget). El archivo ya
 *  está subido al bucket público `comprobantes` — acá se re-descarga para mandarlo
 *  por el mismo canal privado (documentos-telegram) que ya usan ticket/factura. */
function notificarComprobanteSiCorresponde(proveedorId: string, comprobanteUrl: string, indice: number): void {
  const ext = extension(comprobanteUrl);
  void notificarDocumento({
    entidadTipo: 'proveedor',
    entidadId: proveedorId,
    tipoDocumento: 'comprobante',
    nombreArchivo: `comprobante-pago-${indice + 1}.${ext}`,
    contentType: MIME_POR_EXTENSION[ext] ?? 'application/octet-stream',
    generarBuffer: async () => {
      const resp = await fetch(comprobanteUrl);
      if (!resp.ok) throw new Error(`No se pudo descargar el comprobante (status ${resp.status}).`);
      return Buffer.from(await resp.arrayBuffer());
    },
  });
}

/** Adjunta los comprobantes ya subidos al movimiento y notifica cada uno por
 *  Telegram. El pago ya quedó registrado antes de llamar esto — si guardar
 *  los comprobantes falla, no se deshace el pago, solo se loguea. La plata
 *  ya se movió, es lo que importa. */
async function adjuntarComprobante(movimientoId: string, proveedorId: string, comprobantes: string[]): Promise<void> {
  const { error } = await supabaseAdmin
    .from('movimientos')
    .update({ comprobantes })
    .eq('id', movimientoId);

  if (error) {
    logger.error({ evento: 'pago_comprobante_no_guardado', mensaje: error.message, movimientoId });
  } else {
    comprobantes.forEach((url, indice) => notificarComprobanteSiCorresponde(proveedorId, url, indice));
  }
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

  if (input.comprobantes.length > 0) await adjuntarComprobante(movimientoId, input.proveedorId, input.comprobantes);

  return { movimientoId };
}

interface ResultadoPagoMulti {
  movimientoPrincipalId: string;
  movimientoIds: string[];
  grupoId: string;
  numeroPago: number | null;
  numeroAdelanto: number | null;
}

/** Pago combinado ("Registrar pago"): repartido entre una o varias bancas de
 *  origen, liquida varias facturas y/o notas de débito a la vez. El
 *  excedente del total sobre la suma de esos ítems queda como adelanto, en
 *  un movimiento aparte con su propio correlativo (lo separa la RPC). */
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

  if (input.comprobantes.length > 0) {
    await adjuntarComprobante(resultado.movimientoPrincipalId, input.proveedorId, input.comprobantes);
  }

  return resultado;
}
