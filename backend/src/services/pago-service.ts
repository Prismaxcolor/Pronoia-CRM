import { supabaseAdmin } from '../config/supabase.js';
import type { RegistrarPagoInput } from '../schemas/pagos.js';
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

/** Dispara el envío del comprobante por Telegram (fire-and-forget). El archivo ya
 *  está subido al bucket público `comprobantes` — acá se re-descarga para mandarlo
 *  por el mismo canal privado (documentos-telegram) que ya usan ticket/factura. */
function notificarComprobanteSiCorresponde(proveedorId: string, comprobanteUrl: string): void {
  const ext = extension(comprobanteUrl);
  void notificarDocumento({
    entidadTipo: 'proveedor',
    entidadId: proveedorId,
    tipoDocumento: 'comprobante',
    nombreArchivo: `comprobante-pago.${ext}`,
    contentType: MIME_POR_EXTENSION[ext] ?? 'application/octet-stream',
    generarBuffer: async () => {
      const resp = await fetch(comprobanteUrl);
      if (!resp.ok) throw new Error(`No se pudo descargar el comprobante (status ${resp.status}).`);
      return Buffer.from(await resp.arrayBuffer());
    },
  });
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

  if (input.comprobanteUrl) {
    // El pago ya quedó registrado (arriba) — si guardar el comprobante falla, no se
    // deshace el pago, solo se loguea. La plata ya se movió, es lo que importa.
    const { error: errorComprobante } = await supabaseAdmin
      .from('movimientos')
      .update({ comprobante_url: input.comprobanteUrl })
      .eq('id', movimientoId);

    if (errorComprobante) {
      logger.error({
        evento: 'pago_comprobante_no_guardado',
        mensaje: errorComprobante.message,
        movimientoId,
      });
    } else {
      notificarComprobanteSiCorresponde(input.proveedorId, input.comprobanteUrl);
    }
  }

  return { movimientoId };
}
