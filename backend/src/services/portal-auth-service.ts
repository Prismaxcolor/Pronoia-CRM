import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '../config/supabase.js';
import { ENV } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { generarToken, type EntidadTelegram } from './telegram-link-service.js';

const TOKEN_TTL_MINUTOS = 15;
const SESION_TTL_DIAS = 30; // más largo que el del staff — volver a pedir el link cada
// vez que expire es más fricción para un proveedor externo que para un empleado.
const SESION_TTL_MS = SESION_TTL_DIAS * 24 * 60 * 60 * 1000;
const WEBHOOK_TIMEOUT_MS = 10_000;

export const PORTAL_COOKIE_NAME = 'portal_session';

/** httpOnly: JS del portal nunca puede leer el token (mitiga robo por XSS).
 *  sameSite:'none' + secure: frontend y backend viven en orígenes distintos
 *  (dev: puertos distintos o túneles distintos; prod: subdominios distintos). */
export function portalCookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'none' as const,
    path: '/',
    maxAge: SESION_TTL_MS,
  };
}

export interface PortalJwtPayload {
  entidadTipo: EntidadTelegram;
  entidadId: string;
}

interface EntidadEncontrada extends PortalJwtPayload {
  chatId: string;
}

function calcularExpiracion(): string {
  return new Date(Date.now() + TOKEN_TTL_MINUTOS * 60 * 1000).toISOString();
}

interface FilaEntidad {
  id: string;
  telegram_chat_id: string | null;
}

// Consultas separadas por columna (en vez de un solo .or() con el valor
// interpolado en el string del filtro) para no exponer el mini-lenguaje de
// filtros de PostgREST a un valor que viene directo del usuario.
async function buscarPorColumna(tabla: string, columna: string, valor: string): Promise<FilaEntidad | null> {
  const { data } = await supabaseAdmin
    .from(tabla)
    .select('id, telegram_chat_id')
    .eq(columna, valor)
    .not('telegram_chat_id', 'is', null)
    .maybeSingle();
  return data;
}

/** Busca por RIF/cédula o teléfono — solo entidades ya vinculadas a Telegram
 *  pueden loguearse (si no, no hay forma de mandarles el link). */
async function buscarEntidad(identificador: string): Promise<EntidadEncontrada | null> {
  const valor = identificador.trim();

  const proveedor = (await buscarPorColumna('proveedores', 'rfc', valor))
    ?? (await buscarPorColumna('proveedores', 'telefono', valor));
  if (proveedor) {
    return { entidadTipo: 'proveedor', entidadId: proveedor.id, chatId: proveedor.telegram_chat_id! };
  }

  const cliente = (await buscarPorColumna('clientes', 'identificacion', valor))
    ?? (await buscarPorColumna('clientes', 'telefono', valor));
  if (cliente) {
    return { entidadTipo: 'cliente', entidadId: cliente.id, chatId: cliente.telegram_chat_id! };
  }

  return null;
}

/**
 * Siempre "tiene éxito" del lado del que llama — no revela si el identificador
 * existe (protección contra enumeración). Si existe y está vinculado a Telegram,
 * de verdad le manda el link; si no, simplemente no hace nada.
 */
export async function solicitarLogin(identificador: string): Promise<void> {
  try {
    const entidad = await buscarEntidad(identificador);
    if (!entidad) return;
    if (!ENV.N8N_WEBHOOK_PORTAL_LOGIN) return;

    const token = generarToken();
    const { error } = await supabaseAdmin.from('portal_login_tokens').insert({
      entidad_tipo: entidad.entidadTipo,
      entidad_id: entidad.entidadId,
      token,
      expires_at: calcularExpiracion(),
    });

    if (error) {
      logger.error({ evento: 'portal_login_error_token', mensaje: error.message });
      return;
    }

    const deepLink = `${ENV.PORTAL_URL}/portal/verificar?token=${token}`;

    const respuesta = await fetch(ENV.N8N_WEBHOOK_PORTAL_LOGIN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: entidad.chatId, deepLink }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });

    if (!respuesta.ok) {
      logger.error({ evento: 'portal_login_error_webhook_status', status: respuesta.status });
    }
  } catch (err) {
    logger.error({
      evento: 'portal_login_error_inesperado',
      mensaje: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function verificarLoginToken(token: string): Promise<PortalJwtPayload | null> {
  const { data, error } = await supabaseAdmin
    .from('portal_login_tokens')
    .select('id, entidad_tipo, entidad_id, usado, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (error || !data) return null;
  if (data.usado) return null;
  if (new Date(data.expires_at) < new Date()) return null;

  await supabaseAdmin.from('portal_login_tokens').update({ usado: true }).eq('id', data.id);

  return { entidadTipo: data.entidad_tipo, entidadId: data.entidad_id };
}

export function firmarSesionPortal(payload: PortalJwtPayload): string {
  return jwt.sign(payload, ENV.PORTAL_JWT_SECRET, { expiresIn: `${SESION_TTL_DIAS}d` });
}

export function verificarSesionPortal(token: string): PortalJwtPayload {
  return jwt.verify(token, ENV.PORTAL_JWT_SECRET) as PortalJwtPayload;
}
