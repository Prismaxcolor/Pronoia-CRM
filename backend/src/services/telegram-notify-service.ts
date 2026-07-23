import { supabaseAdmin } from '../config/supabase.js';
import { ENV } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { TABLA_ENTIDAD, type EntidadTelegram } from './telegram-link-service.js';

const BUCKET = 'documentos-telegram';
// El archivo queda en Storage indefinidamente aunque esta URL expire — deuda técnica
// conocida, sin mecanismo de limpieza todavía (candidato: regla de lifecycle en el
// bucket o un cron mensual).
const SIGNED_URL_TTL_SEGUNDOS = 60 * 60 * 24; // n8n solo necesita descargarlo una vez
const WEBHOOK_TIMEOUT_MS = 10_000;

interface Contacto {
  nombre: string;
  chatId: string;
}

async function obtenerContacto(entidadTipo: EntidadTelegram, entidadId: string): Promise<Contacto | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLA_ENTIDAD[entidadTipo])
    .select('nombre, telegram_chat_id')
    .eq('id', entidadId)
    .maybeSingle();

  if (error || !data || !data.telegram_chat_id) return null;
  return { nombre: data.nombre, chatId: data.telegram_chat_id };
}

export interface NotificarDocumentoParams {
  entidadTipo: EntidadTelegram;
  entidadId: string;
  tipoDocumento: 'ticket' | 'factura' | 'comprobante';
  nombreArchivo: string;
  /** 'application/pdf' para ticket/factura; el mime real de la imagen para comprobante. */
  contentType?: string;
  /** Genera el documento solo si hace falta (evita el trabajo si no hay a quién avisar).
   *  Puede ser async — el comprobante ya viene de una URL subida, no de un PDF armado
   *  al vuelo, así que necesita poder descargarlo antes de devolver el buffer. */
  generarBuffer: (nombreEntidad: string) => Buffer | Promise<Buffer>;
}

/**
 * Fire-and-forget deliberado: cerrar un pesaje o emitir una factura NUNCA debe
 * fallar por un problema de Telegram/Storage/n8n. Todo error queda solo logueado.
 */
export async function notificarDocumento(params: NotificarDocumentoParams): Promise<void> {
  try {
    const contacto = await obtenerContacto(params.entidadTipo, params.entidadId);
    if (!contacto) return; // no vinculado a Telegram todavía — no hay a quién avisar
    if (!ENV.N8N_WEBHOOK_ENVIAR_DOCUMENTO) return;

    const buffer = await params.generarBuffer(contacto.nombre);
    const ruta = `${params.entidadTipo}/${params.entidadId}/${Date.now()}-${params.nombreArchivo}`;

    const { error: errorSubida } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(ruta, buffer, { contentType: params.contentType ?? 'application/pdf' });

    if (errorSubida) {
      logger.error({ evento: 'telegram_notify_error_storage', mensaje: errorSubida.message });
      return;
    }

    const { data: firmada, error: errorFirma } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(ruta, SIGNED_URL_TTL_SEGUNDOS);

    if (errorFirma || !firmada) {
      logger.error({ evento: 'telegram_notify_error_signed_url', mensaje: errorFirma?.message });
      return;
    }

    const respuesta = await fetch(ENV.N8N_WEBHOOK_ENVIAR_DOCUMENTO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipoDocumento: params.tipoDocumento,
        entidadTipo: params.entidadTipo,
        entidadId: params.entidadId,
        chatId: contacto.chatId,
        nombreEntidad: contacto.nombre,
        url: firmada.signedUrl,
        nombreArchivo: params.nombreArchivo,
      }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });

    if (!respuesta.ok) {
      logger.error({ evento: 'telegram_notify_error_webhook_status', status: respuesta.status });
    }
  } catch (err) {
    logger.error({
      evento: 'telegram_notify_error_inesperado',
      mensaje: err instanceof Error ? err.message : String(err),
    });
  }
}
