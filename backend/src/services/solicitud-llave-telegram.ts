import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { formatearHoraNegocio } from '../utils/fecha-negocio.js';
import { aprobarSolicitud, rechazarSolicitud, resumenSolicitud, type SolicitudLlaveDto } from './solicitud-llave-service.js';
import { textoDetalleSolicitud } from './solicitud-llave-aviso.js';

/**
 * Resolución de solicitudes de llave desde los botones de Telegram (callback que reenvía n8n).
 * Reusa aprobarSolicitud / rechazarSolicitud del servicio web (reclamo atómico, auditoría y aviso al
 * solicitante incluidos). NUNCA devuelve el código de la llave. Nunca lanza.
 */

export interface RespuestaCallbackLlave {
  ok: boolean;
  /** Texto corto para el aviso emergente de Telegram (answerCallbackQuery). */
  alerta: string;
  /** Texto con el que n8n reemplaza el mensaje (sin botones). Ausente si no hay nada que reescribir. */
  nuevoTexto?: string;
}

const PATRON_CALLBACK = /^llave:([ar]):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const MOTIVO_RECHAZO_TELEGRAM = 'Rechazada desde Telegram';

export const ALERTA_NO_SUPERADMIN = 'Solo un superadmin con Telegram vinculado puede resolver solicitudes.';
const ALERTA_INVALIDA = 'Acción no reconocida.';
const ALERTA_NO_ENCONTRADA = 'La solicitud no existe.';
const ALERTA_NO_DISPONIBLE = 'No se pudo procesar la solicitud en este momento. Inténtalo desde la app.';

interface Actor {
  id: string;
  nombre: string;
}

/** Superadmin activo cuyo chat privado (telegram_chat_id) es el id de usuario de Telegram. null si no hay o la columna no existe. */
async function buscarSuperadmin(telegramUserId: string): Promise<Actor | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, nombre')
      .eq('telegram_chat_id', telegramUserId)
      .eq('rol', 'superadmin')
      .eq('activo', true)
      .limit(1);
    if (error) {
      logger.warn({ evento: 'llave_callback_usuario_no_disponible', motivo: error.message });
      return null;
    }
    const fila = ((data ?? []) as Array<{ id: string; nombre: string | null }>)[0];
    return fila ? { id: fila.id, nombre: fila.nombre ?? 'superadmin' } : null;
  } catch (err) {
    logger.warn({ evento: 'llave_callback_usuario_no_disponible', motivo: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

const hora = (iso: string | null): string => (iso ? formatearHoraNegocio(iso) : '—');

function lineaResolucion(d: SolicitudLlaveDto): string {
  const quien = d.aprobadorNombre ?? '—';
  const cuando = hora(d.resueltaEn);
  switch (d.estado) {
    case 'rechazada':
      return `❌ Rechazada por ${quien} a las ${cuando}.`;
    case 'aprobada':
      return `✅ Aprobada por ${quien} a las ${cuando}. Vence ${hora(d.expiraEn)}.`;
    case 'usada':
      return `✅ Aprobada por ${quien} a las ${cuando}. La llave ya fue usada.`;
    default:
      return d.aprobadorNombre ? `✅ Aprobada por ${quien} a las ${cuando}. La llave venció.` : '⌛ La solicitud venció sin resolverse.';
  }
}

const textoActualizado = (d: SolicitudLlaveDto): string => `${textoDetalleSolicitud(d)}\n\n${lineaResolucion(d)}`;

function yaResuelta(d: SolicitudLlaveDto): RespuestaCallbackLlave {
  const alerta = d.aprobadorNombre
    ? `Esta solicitud ya fue resuelta (${d.estado}) por ${d.aprobadorNombre}.`
    : `Esta solicitud ya no está pendiente (${d.estado}).`;
  return { ok: false, alerta, nuevoTexto: textoActualizado(d) };
}

async function ejecutar(accion: 'a' | 'r', solicitudId: string, actor: Actor): Promise<RespuestaCallbackLlave> {
  const resultado = accion === 'a'
    ? await aprobarSolicitud(solicitudId, actor.id)
    : await rechazarSolicitud(solicitudId, actor.id, MOTIVO_RECHAZO_TELEGRAM);
  if (resultado.ok) {
    logger.info({ evento: 'solicitud_llave_resuelta_telegram', userId: actor.id, solicitudId, accion });
    return {
      ok: true,
      alerta: accion === 'a' ? 'Llave aprobada ✅' : 'Solicitud rechazada ❌',
      nuevoTexto: textoActualizado(resultado.data),
    };
  }
  if (resultado.codigo === 409) {
    // Otro superadmin la resolvió justo antes: se informa con el estado real.
    const actual = await resumenSolicitud(solicitudId);
    if (actual.ok) return yaResuelta(actual.data);
  }
  return { ok: false, alerta: resultado.codigo === 404 ? ALERTA_NO_ENCONTRADA : resultado.error };
}

export async function resolverDesdeTelegram(entrada: { telegramUserId: string; callbackData: string }): Promise<RespuestaCallbackLlave> {
  try {
    const partes = PATRON_CALLBACK.exec(entrada.callbackData.trim());
    if (!partes) return { ok: false, alerta: ALERTA_INVALIDA };
    const accion = partes[1].toLowerCase() as 'a' | 'r';
    const solicitudId = partes[2].toLowerCase();

    const actor = await buscarSuperadmin(entrada.telegramUserId);
    if (!actor) {
      logger.warn({ evento: 'llave_callback_rechazado_no_superadmin' });
      return { ok: false, alerta: ALERTA_NO_SUPERADMIN };
    }

    const actual = await resumenSolicitud(solicitudId);
    if (!actual.ok) return { ok: false, alerta: actual.codigo === 404 ? ALERTA_NO_ENCONTRADA : ALERTA_NO_DISPONIBLE };
    if (actual.data.estado !== 'pendiente') return yaResuelta(actual.data);

    return await ejecutar(accion, solicitudId, actor);
  } catch (err) {
    logger.error({ evento: 'llave_callback_error', mensaje: err instanceof Error ? err.message : String(err) });
    return { ok: false, alerta: ALERTA_NO_DISPONIBLE };
  }
}
