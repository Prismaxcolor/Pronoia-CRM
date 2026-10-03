import { supabaseAdmin } from '../config/supabase.js';
import { ENV } from '../config/env.js';
import { nombreArchivoSeguro } from '../utils/nombre-archivo.js';
import { cabecerasWebhookN8n } from '../utils/n8n-headers.js';
import { logger } from '../utils/logger.js';
import { TABLA_ENTIDAD, type EntidadTelegram } from './telegram-link-service.js';

const BUCKET = 'documentos-telegram';
// El archivo queda en Storage indefinidamente aunque esta URL expire — deuda técnica
// conocida, sin mecanismo de limpieza todavía (candidato: regla de lifecycle en el
// bucket o un cron mensual).
const SIGNED_URL_TTL_SEGUNDOS = 60 * 60 * 24; // n8n solo necesita descargarlo una vez
const WEBHOOK_TIMEOUT_MS = 10_000;
/** Un álbum con varias fotos tarda más: Telegram baja cada imagen desde su URL. */
const WEBHOOK_FOTOS_TIMEOUT_MS = 30_000;
/** Límite de Telegram para sendMediaGroup (2 a 10 elementos por álbum). */
export const MAX_FOTOS_POR_ALBUM = 10;
/** Límite de Telegram para el pie de foto/documento. */
const MAX_CAPTION = 1000;

export type TipoDocumentoTelegram =
  | 'ticket'
  | 'factura'
  | 'comprobante'
  | 'nota'
  | 'pago'
  | 'cruce'
  | 'estado_cuenta'
  | 'cita'
  | 'aviso';

interface Contacto {
  nombre: string;
  chatId: string;
}

export interface FotoEnvio {
  /** URL pública (https) de la imagen — Telegram la descarga directamente. */
  url: string;
  caption?: string;
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

/** ¿La entidad ya está vinculada a Telegram? (para avisar al usuario antes de un envío a pedido). */
export async function entidadVinculada(entidadTipo: EntidadTelegram, entidadId: string): Promise<boolean> {
  return (await obtenerContacto(entidadTipo, entidadId)) !== null;
}

function recortar(texto: string | undefined): string | undefined {
  if (!texto) return undefined;
  return texto.length > MAX_CAPTION ? `${texto.slice(0, MAX_CAPTION - 1)}…` : texto;
}

/**
 * Reparte las fotos en álbumes de 2 a 10 (sendMediaGroup no acepta uno solo ni más
 * de 10). Un grupo de 1 foto se manda como foto suelta; si la división dejara un
 * álbum de 1, se reparte parejo (11 → 6 + 5, nunca 10 + 1).
 */
export function repartirFotos(fotos: FotoEnvio[]): FotoEnvio[][] {
  const validas = fotos.filter(f => /^https:\/\//i.test(f.url));
  const unicas = validas.filter((f, i) => validas.findIndex(g => g.url === f.url) === i);
  if (unicas.length === 0) return [];
  const grupos = Math.ceil(unicas.length / MAX_FOTOS_POR_ALBUM);
  const base = Math.floor(unicas.length / grupos);
  const extra = unicas.length % grupos;
  const resultado: FotoEnvio[][] = [];
  let desde = 0;
  for (let i = 0; i < grupos; i++) {
    const tamano = base + (i < extra ? 1 : 0);
    resultado.push(unicas.slice(desde, desde + tamano));
    desde += tamano;
  }
  return resultado;
}

interface CuerpoBase {
  tipoDocumento: TipoDocumentoTelegram;
  entidadTipo: EntidadTelegram;
  entidadId: string;
}

/** POST al webhook v2 de n8n. Devuelve true si n8n respondió 2xx. Nunca lanza. */
async function llamarWebhook(
  contacto: Contacto,
  base: CuerpoBase,
  payload: Record<string, unknown>,
  timeoutMs = WEBHOOK_TIMEOUT_MS
): Promise<boolean> {
  try {
    const respuesta = await fetch(ENV.N8N_WEBHOOK_ENVIAR_CONTENIDO, {
      method: 'POST',
      headers: cabecerasWebhookN8n(),
      body: JSON.stringify({
        tipoDocumento: base.tipoDocumento,
        entidadTipo: base.entidadTipo,
        entidadId: base.entidadId,
        chatId: contacto.chatId,
        nombreEntidad: contacto.nombre,
        ...payload,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!respuesta.ok) {
      logger.error({ evento: 'telegram_notify_error_webhook_status', status: respuesta.status, accion: payload.accion });
      return false;
    }
    return true;
  } catch (err) {
    logger.error({
      evento: 'telegram_notify_error_webhook',
      accion: payload.accion,
      mensaje: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Manda las fotos en álbumes (o una foto suelta), en orden y de a un envío por vez. */
async function enviarFotos(contacto: Contacto, base: CuerpoBase, fotos: FotoEnvio[]): Promise<void> {
  for (const grupo of repartirFotos(fotos)) {
    await llamarWebhook(
      contacto,
      base,
      {
        accion: grupo.length === 1 ? 'foto' : 'fotos',
        fotos: grupo.map(f => ({ url: f.url, caption: recortar(f.caption) })),
      },
      WEBHOOK_FOTOS_TIMEOUT_MS
    );
  }
}

/** Documento ya armado, listo para subir. */
export interface DocumentoPreparado {
  buffer: Buffer;
  nombreArchivo: string;
  /** 'application/pdf' por defecto; el mime real si es una imagen. */
  contentType?: string;
  /** Pie del documento. Sin esto, n8n usa un texto genérico según tipoDocumento. */
  mensaje?: string;
  /** Fotos que van después del documento (álbumes de hasta 10). */
  fotos?: FotoEnvio[];
}

export interface NotificarDocumentoParams {
  entidadTipo: EntidadTelegram;
  entidadId: string;
  tipoDocumento: TipoDocumentoTelegram;
  /** Genera el documento solo si hace falta (evita el trabajo si no hay a quién avisar).
   *  Puede ser async: lee de la BD lo que necesite. Recibe el nombre ya resuelto. */
  preparar: (nombreEntidad: string) => DocumentoPreparado | Promise<DocumentoPreparado>;
}

/**
 * Fire-and-forget deliberado: cerrar un pesaje o emitir una factura NUNCA debe
 * fallar por un problema de Telegram/Storage/n8n. Todo error queda solo logueado.
 * Sube el documento al bucket privado, firma la URL, avisa a n8n y, si el documento
 * trae fotos, las manda a continuación como álbum.
 */
export async function notificarDocumento(params: NotificarDocumentoParams): Promise<void> {
  try {
    if (!ENV.N8N_WEBHOOK_ENVIAR_CONTENIDO) return;
    const contacto = await obtenerContacto(params.entidadTipo, params.entidadId);
    if (!contacto) return; // no vinculado a Telegram todavía — no hay a quién avisar

    const doc = await params.preparar(contacto.nombre);
    const ruta = `${params.entidadTipo}/${params.entidadId}/${Date.now()}-${nombreArchivoSeguro(doc.nombreArchivo)}`;

    const { error: errorSubida } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(ruta, doc.buffer, { contentType: doc.contentType ?? 'application/pdf' });

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

    const base: CuerpoBase = { tipoDocumento: params.tipoDocumento, entidadTipo: params.entidadTipo, entidadId: params.entidadId };
    await llamarWebhook(contacto, base, {
      accion: 'documento',
      url: firmada.signedUrl,
      nombreArchivo: doc.nombreArchivo,
      mensaje: recortar(doc.mensaje),
    });

    if (doc.fotos && doc.fotos.length > 0) await enviarFotos(contacto, base, doc.fotos);
  } catch (err) {
    logger.error({
      evento: 'telegram_notify_error_inesperado',
      mensaje: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface NotificarMensajeParams {
  entidadTipo: EntidadTelegram;
  entidadId: string;
  tipoDocumento: TipoDocumentoTelegram;
  /** Texto plano (sin Markdown/HTML), hasta 4096 caracteres. */
  mensaje: string | ((nombreEntidad: string) => string);
}

/** Mensaje de texto sin adjuntos (avisos: cita confirmada, etc.). Mismo contrato fire-and-forget. */
export async function notificarMensaje(params: NotificarMensajeParams): Promise<void> {
  try {
    if (!ENV.N8N_WEBHOOK_ENVIAR_CONTENIDO) return;
    const contacto = await obtenerContacto(params.entidadTipo, params.entidadId);
    if (!contacto) return;
    const texto = typeof params.mensaje === 'function' ? params.mensaje(contacto.nombre) : params.mensaje;
    await llamarWebhook(
      contacto,
      { tipoDocumento: params.tipoDocumento, entidadTipo: params.entidadTipo, entidadId: params.entidadId },
      { accion: 'mensaje', mensaje: texto.slice(0, 4000) }
    );
  } catch (err) {
    logger.error({
      evento: 'telegram_notify_error_inesperado',
      mensaje: err instanceof Error ? err.message : String(err),
    });
  }
}
