import { supabaseAdmin } from '../config/supabase.js';
import type { RegistrarCobroMultipleInput } from '../schemas/cobros.js';
import { notificarDocumento } from './telegram-notify-service.js';
import { logger } from '../utils/logger.js';

/** Espejo de pago-service.ts (registrarPagoMultiple) para cobros a cliente —
 *  ver nota en nota-ajuste-cliente-service.ts sobre por qué es un archivo
 *  aparte en vez de generalizar el de proveedor. */

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

function notificarComprobanteSiCorresponde(clienteId: string, comprobanteUrl: string): void {
  const ext = extension(comprobanteUrl);
  void notificarDocumento({
    entidadTipo: 'cliente',
    entidadId: clienteId,
    tipoDocumento: 'comprobante',
    nombreArchivo: `comprobante-cobro.${ext}`,
    contentType: MIME_POR_EXTENSION[ext] ?? 'application/octet-stream',
    generarBuffer: async () => {
      const resp = await fetch(comprobanteUrl);
      if (!resp.ok) throw new Error(`No se pudo descargar el comprobante (status ${resp.status}).`);
      return Buffer.from(await resp.arrayBuffer());
    },
  });
}

async function adjuntarComprobante(movimientoId: string, clienteId: string, comprobanteUrl: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('movimientos')
    .update({ comprobante_url: comprobanteUrl })
    .eq('id', movimientoId);

  if (error) {
    logger.error({ evento: 'cobro_comprobante_no_guardado', mensaje: error.message, movimientoId });
  } else {
    notificarComprobanteSiCorresponde(clienteId, comprobanteUrl);
  }
}

interface ResultadoCobroMulti {
  movimientoPrincipalId: string;
  movimientoIds: string[];
  grupoId: string;
  numeroCobro: number | null;
  numeroAnticipo: number | null;
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

  if (input.comprobanteUrl) {
    await adjuntarComprobante(resultado.movimientoPrincipalId, input.clienteId, input.comprobanteUrl);
  }

  return resultado;
}
