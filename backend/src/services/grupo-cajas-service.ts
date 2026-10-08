import { supabaseAdmin } from '../config/supabase.js';
import { ENV } from '../config/env.js';
import { obtenerSecreto } from '../config/secretos.js';
import { cabecerasWebhookN8n } from '../utils/n8n-headers.js';
import { logger } from '../utils/logger.js';
import { cuentasDeBody, htmlATextoPlano, lineaCuenta } from './grupo-dinero.js';
import { repartirFotos } from './telegram-notify-service.js';
import { validarBotones } from '../utils/botones-aviso.js';
import type { PayloadGrupo } from './grupo-notificar-service.js';

/**
 * Entrega de los avisos de dinero al grupo de Telegram "P.S Cajas Pagos".
 *
 * Reusa el webhook v2 de n8n (N8N_WEBHOOK_ENVIAR_CONTENIDO: mensaje / foto / fotos / documento) con el chat
 * id del grupo (TELEGRAM_CAJAS_CHAT_ID), así el backend no guarda ningún token del bot. El
 * workflow v2 manda texto plano (sin HTML), por eso el mensaje se convierte antes de enviarlo.
 * Sin chat id o sin webhook no se envía nada y no es un error. NUNCA lanza.
 */

const WEBHOOK_TIMEOUT_MS = 10_000;
const WEBHOOK_FOTOS_TIMEOUT_MS = 30_000;
/** Límite de Telegram para el pie de una foto. */
const MAX_CAPTION = 1_000;
const MAX_MENSAJE = 4_000;
export const NOMBRE_GRUPO_CAJAS = 'P.S Cajas Pagos';

/** Chat id del grupo general de cajas: variable de entorno o, si no hay, configuracion_secreta. '' si no hay. Nunca lanza. */
export async function chatIdCajas(): Promise<string> {
  return ((await obtenerSecreto('TELEGRAM_CAJAS_CHAT_ID')) ?? '').trim();
}

/** Grupo propio de la primera cuenta del body que tenga uno (columna bancas.telegram_chat_id). '' si ninguna. Nunca lanza. */
async function chatIdDeBancas(body: Readonly<Record<string, unknown>>): Promise<string> {
  const refs = cuentasDeBody(body);
  if (refs.length === 0) return '';
  try {
    const ids = [...new Set(refs.map(r => r.id))];
    const { data, error } = await supabaseAdmin.from('bancas').select('id, telegram_chat_id').in('id', ids);
    if (error) {
      // Cae al grupo general: se registra para no perder el aviso de por qué no fue al grupo de la cuenta.
      logger.error({ evento: 'cajas_chat_banca_lectura_fallida', codigo: error.code, mensaje: error.message });
      return '';
    }
    const filas = (data ?? []) as Array<{ id: string; telegram_chat_id?: string | null }>;
    const porId = new Map(filas.map(f => [f.id, (f.telegram_chat_id ?? '').trim()]));
    // Se respeta el orden de cuentasDeBody (origen primero). Columna inexistente => data null => ''.
    return refs.map(r => porId.get(r.id) ?? '').find(chat => chat !== '') ?? '';
  } catch (e) {
    logger.error({ evento: 'cajas_chat_banca_lectura_fallida', mensaje: e instanceof Error ? e.message : String(e) });
    return '';
  }
}

/**
 * Chat al que va el aviso de dinero: el de la banca que interviene (si tiene uno) o, si no, el grupo
 * general de cajas. '' si no hay ninguno. Sin banca en el body (anulaciones, facturas) usa el general.
 */
export async function chatIdParaBody(body: Readonly<Record<string, unknown>>): Promise<string> {
  return (await chatIdDeBancas(body)) || (await chatIdCajas());
}

/** ¿Hay webhook de entrega y un chat de destino? */
export function puedeEnviarACajas(chatId: string): boolean {
  return Boolean(ENV.N8N_WEBHOOK_ENVIAR_CONTENIDO && chatId);
}

/** Líneas "Cuenta origen: Banesco — 1.200 VES" de las bancas que menciona el body. Nunca lanza. */
export async function lineasDeCuentas(body: Readonly<Record<string, unknown>>): Promise<string[]> {
  const refs = cuentasDeBody(body);
  if (refs.length === 0) return [];
  try {
    const ids = [...new Set(refs.map(r => r.id))];
    const { data } = await supabaseAdmin.from('bancas').select('id, nombre, moneda').in('id', ids);
    const filas = (data ?? []) as Array<{ id: string; nombre: string | null; moneda: string | null }>;
    const porId = new Map(filas.map(f => [f.id, f]));
    return refs.map(r => lineaCuenta(r, porId.get(r.id)?.nombre ?? null, porId.get(r.id)?.moneda ?? null));
  } catch {
    return refs.map(r => lineaCuenta(r, null, null));
  }
}

/** Devuelve true si el webhook aceptó el envío. Nunca lanza. */
async function llamarWebhook(chatId: string, cuerpo: Record<string, unknown>, timeoutMs: number): Promise<boolean> {
  try {
    if (!chatId) return false;
    const respuesta = await fetch(ENV.N8N_WEBHOOK_ENVIAR_CONTENIDO, {
      method: 'POST',
      headers: await cabecerasWebhookN8n(),
      body: JSON.stringify({
        tipoDocumento: 'aviso',
        entidadTipo: 'cajas',
        chatId,
        nombreEntidad: NOMBRE_GRUPO_CAJAS,
        ...cuerpo,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!respuesta.ok) {
      logger.error({ evento: 'cajas_notify_error_webhook_status', status: respuesta.status, accion: cuerpo.accion });
      return false;
    }
    return true;
  } catch (err) {
    logger.error({
      evento: 'cajas_notify_error_webhook',
      accion: cuerpo.accion,
      mensaje: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

const recortar = (t: string, max: number): string => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

/**
 * Manda el aviso de dinero a "P.S Cajas Pagos". El mensaje viaja como pie del primer adjunto
 * (PDF de la factura o, si no hay, la primera foto del comprobante); si no cabe en el pie o no hay
 * adjuntos, va como mensaje aparte. Si el adjunto que llevaba el pie falla, se reintenta el texto.
 */
export async function enviarACajas(payload: PayloadGrupo): Promise<void> {
  try {
    // chatId lo resolvió construirPayloadGrupo (banca o general); sin él, el general.
    const chatId = payload.chatId || (await chatIdCajas());
    if (!ENV.GRUPO_NOTIFICACIONES_ACTIVAS || !puedeEnviarACajas(chatId)) return;
    const texto = htmlATextoPlano(payload.texto);
    const albumes = repartirFotos((payload.fotos ?? []).map(url => ({ url })));
    // Con botones el texto va siempre como mensaje propio (el botón cuelga del mensaje, no de un pie de foto).
    const botones = validarBotones(payload.botones);
    const cabeEnPie = botones.length === 0 && texto.length <= MAX_CAPTION;
    const hayDocumento = Boolean(payload.documentoUrl);
    const hayAdjuntos = hayDocumento || albumes.length > 0;

    const enviarTexto = () => llamarWebhook(chatId, {
      accion: 'mensaje',
      mensaje: recortar(texto, MAX_MENSAJE),
      ...(botones.length > 0 ? { botones } : {}),
    }, WEBHOOK_TIMEOUT_MS);
    const textoPendiente = hayAdjuntos && cabeEnPie;

    if (!hayAdjuntos || !cabeEnPie) await enviarTexto();
    if (hayDocumento) {
      const enviado = await llamarWebhook(chatId, {
        accion: 'documento',
        url: payload.documentoUrl,
        nombreArchivo: payload.nombreArchivo,
        ...(cabeEnPie ? { mensaje: texto } : {}),
      }, WEBHOOK_FOTOS_TIMEOUT_MS);
      if (!enviado && textoPendiente) {
        logger.error({ evento: 'cajas_notify_reintento_texto', clave: payload.evento });
        await enviarTexto();
      }
    }
    for (const [i, album] of albumes.entries()) {
      const llevaPie = i === 0 && cabeEnPie && !hayDocumento;
      const fotos = album.map((f, j) => ({ url: f.url, caption: llevaPie && j === 0 ? texto : undefined }));
      const enviado = await llamarWebhook(chatId, { accion: fotos.length === 1 ? 'foto' : 'fotos', fotos }, WEBHOOK_FOTOS_TIMEOUT_MS);
      if (!enviado && llevaPie && textoPendiente) {
        logger.error({ evento: 'cajas_notify_reintento_texto', clave: payload.evento });
        await enviarTexto();
      }
    }
  } catch (err) {
    logger.error({
      evento: 'cajas_notify_error_inesperado',
      clave: payload.evento,
      mensaje: err instanceof Error ? err.message : String(err),
    });
  }
}
