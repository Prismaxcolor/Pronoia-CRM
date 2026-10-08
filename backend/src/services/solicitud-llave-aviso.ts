import { ENV } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { formatearHoraNegocio } from '../utils/fecha-negocio.js';
import { cabecerasWebhookN8n } from '../utils/n8n-headers.js';
import type { BotonAviso } from '../utils/botones-aviso.js';
import type { SolicitudLlaveAviso } from '../utils/solicitud-llave-tipos.js';

/**
 * Avisos de Telegram de las solicitudes de llave de edición, por MENSAJE PRIVADO: la solicitud llega a
 * cada superadmin con Telegram vinculado (botones Aprobar/Rechazar que resuelve n8n contra
 * POST /api/llaves-solicitudes/telegram-callback) y la resolución al solicitante. Texto plano por el
 * webhook v2 de n8n (N8N_WEBHOOK_ENVIAR_CONTENIDO). NUNCA se envía el código de la llave. NUNCA lanzan.
 */

const WEBHOOK_TIMEOUT_MS = 10_000;

interface DestinoPrivado {
  id: string;
  nombre: string;
  chatId: string;
}

/** Datos de la solicitud sin la línea de vencimiento (sirve también para reescribir el mensaje al resolverse). */
export function textoDetalleSolicitud(s: Pick<SolicitudLlaveAviso, 'solicitanteNombre' | 'descripcion' | 'motivo'>): string {
  return [
    '🔑 Solicitud de llave',
    `De: ${s.solicitanteNombre}`,
    `Para editar: ${s.descripcion}`,
    `Motivo: ${s.motivo}`,
  ].join('\n');
}

export function textoSolicitud(s: SolicitudLlaveAviso): string {
  const hora = s.venceEn ? formatearHoraNegocio(s.venceEn) : '—';
  return hora === '—' ? textoDetalleSolicitud(s) : `${textoDetalleSolicitud(s)}\nVence: ${hora}`;
}

export function textoAprobadaSolicitante(s: SolicitudLlaveAviso): string {
  const hora = s.llaveExpiraEn ? formatearHoraNegocio(s.llaveExpiraEn) : '—';
  const vence = hora === '—' ? '' : ` Vuelve a la pantalla de edición: la llave vence ${hora}.`;
  return `✅ Tu solicitud de llave fue aprobada por ${s.aprobadorNombre ?? '—'}.${vence}`;
}

export function textoRechazadaSolicitante(s: SolicitudLlaveAviso): string {
  const base = `❌ Tu solicitud de llave fue rechazada por ${s.aprobadorNombre ?? '—'}.`;
  const motivo = s.motivoRechazo?.trim();
  return motivo ? `${base} Motivo: ${motivo}` : base;
}

const botonesDe = (id: string): BotonAviso[] => [
  { texto: '✅ Aprobar', callback: `llave:a:${id}` },
  { texto: '❌ Rechazar', callback: `llave:r:${id}` },
];

/** Superadmins activos con Telegram vinculado. [] si no hay o si las columnas aún no existen. Nunca lanza. */
async function superadminsVinculados(): Promise<DestinoPrivado[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, nombre, telegram_chat_id')
      .eq('rol', 'superadmin')
      .eq('activo', true)
      .not('telegram_chat_id', 'is', null);
    if (error) {
      logger.warn({ evento: 'llave_aviso_superadmins_no_disponibles', motivo: error.message });
      return [];
    }
    const filas = (data ?? []) as Array<{ id: string; nombre: string | null; telegram_chat_id: string | null }>;
    return filas
      .filter(f => Boolean(f.telegram_chat_id?.toString().trim()))
      .map(f => ({ id: f.id, nombre: f.nombre ?? 'superadmin', chatId: String(f.telegram_chat_id).trim() }));
  } catch (err) {
    logger.warn({ evento: 'llave_aviso_superadmins_no_disponibles', motivo: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/** Chat privado del usuario; null si no lo vinculó o la columna no existe. Nunca lanza. */
async function chatPrivadoDe(userId: string | null | undefined): Promise<DestinoPrivado | null> {
  if (!userId) return null;
  try {
    const { data, error } = await supabaseAdmin.from('users').select('id, nombre, telegram_chat_id').eq('id', userId).maybeSingle();
    if (error || !data) return null;
    const fila = data as { id: string; nombre: string | null; telegram_chat_id: string | null };
    const chatId = fila.telegram_chat_id?.toString().trim();
    return chatId ? { id: fila.id, nombre: fila.nombre ?? '', chatId } : null;
  } catch {
    return null;
  }
}

/** Mensaje privado por el webhook v2 de n8n. true si el webhook lo aceptó. Nunca lanza. */
async function enviarPrivado(destino: DestinoPrivado, mensaje: string, botones: BotonAviso[], evento: string): Promise<boolean> {
  try {
    if (!ENV.N8N_WEBHOOK_ENVIAR_CONTENIDO) return false;
    const respuesta = await fetch(ENV.N8N_WEBHOOK_ENVIAR_CONTENIDO, {
      method: 'POST',
      headers: await cabecerasWebhookN8n(),
      body: JSON.stringify({
        tipoDocumento: 'aviso',
        entidadTipo: 'usuario',
        entidadId: destino.id,
        chatId: destino.chatId,
        nombreEntidad: destino.nombre,
        accion: 'mensaje',
        mensaje,
        ...(botones.length > 0 ? { botones } : {}),
      }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!respuesta.ok) {
      logger.error({ evento: 'llave_aviso_error_webhook_status', clave: evento, status: respuesta.status });
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ evento: 'llave_aviso_error', clave: evento, mensaje: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** Avisa por privado, con botones Aprobar/Rechazar, a cada superadmin vinculado. Si no hay ninguno, solo advierte en el log. */
export async function avisarSolicitudLlave(s: SolicitudLlaveAviso): Promise<void> {
  try {
    const destinos = await superadminsVinculados();
    if (destinos.length === 0) {
      logger.warn({ evento: 'llave_aviso_sin_superadmin_vinculado', solicitudId: s.id });
      return;
    }
    const texto = textoSolicitud(s);
    const botones = botonesDe(s.id);
    const resultados = await Promise.all(destinos.map(d => enviarPrivado(d, texto, botones, 'llave_solicitud.creada')));
    logger.info({
      evento: 'llave_aviso_superadmins',
      solicitudId: s.id,
      avisados: resultados.filter(Boolean).length,
      vinculados: destinos.length,
    });
  } catch (err) {
    logger.error({ evento: 'llave_aviso_error', mensaje: err instanceof Error ? err.message : String(err) });
  }
}

/** Avisa al SOLICITANTE (por privado, si vinculó Telegram) que su solicitud fue aprobada o rechazada. Nunca incluye el código. */
export async function avisarResolucionLlave(s: SolicitudLlaveAviso): Promise<void> {
  try {
    if (s.estado !== 'aprobada' && s.estado !== 'rechazada') return;
    const destino = await chatPrivadoDe(s.solicitanteId);
    if (!destino) return;
    const texto = s.estado === 'aprobada' ? textoAprobadaSolicitante(s) : textoRechazadaSolicitante(s);
    await enviarPrivado(destino, texto, [], `llave_solicitud.${s.estado}`);
  } catch (err) {
    logger.error({ evento: 'llave_aviso_error', mensaje: err instanceof Error ? err.message : String(err) });
  }
}
