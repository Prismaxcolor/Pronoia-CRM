import { supabaseAdmin } from '../config/supabase.js';
import { ENV } from '../config/env.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import { generarToken, construirDeepLink } from './telegram-link-service.js';

/** TTL más corto que el de proveedores (48 h): el enlace lo abre la propia persona, en el momento. */
export const TOKEN_USUARIO_TTL_MINUTOS = 30;

const MENSAJE_MIGRACION_PENDIENTE =
  'El enlace de Telegram de usuarios aún no está habilitado en la base de datos (falta aplicar migration_users_telegram.sql).';

export type ResultadoLinkUsuario = { deepLink: string; expiraEn: string } | { error: string; status: number };
export type ResultadoDesvinculo = { ok: true } | { error: string; status: number };

export function calcularExpiracionUsuario(desde: Date = new Date()): string {
  return new Date(desde.getTime() + TOKEN_USUARIO_TTL_MINUTOS * 60 * 1000).toISOString();
}

/** Un usuario gestiona su propio Telegram; solo un superadmin gestiona el de otra persona. */
export function puedeGestionarTelegramDe(actor: { id: string; rol: string }, usuarioId: string): boolean {
  return actor.id === usuarioId || actor.rol === 'superadmin';
}

async function buscarUsuarioActivo(usuarioId: string): Promise<{ ok: true } | { error: string; status: number }> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, activo')
    .eq('id', usuarioId)
    .maybeSingle();
  if (error) return { error: 'No se pudo consultar el usuario.', status: 500 };
  if (!data) return { error: 'Usuario no encontrado.', status: 404 };
  if (!data.activo) return { error: 'El usuario está desactivado.', status: 400 };
  return { ok: true };
}

async function invalidarTokensPendientes(usuarioId: string): Promise<void> {
  await supabaseAdmin
    .from('telegram_link_tokens')
    .update({ usado: true })
    .eq('entidad_tipo', 'usuario')
    .eq('entidad_id', usuarioId)
    .eq('usado', false);
}

export async function generarLinkTelegramUsuario(usuarioId: string): Promise<ResultadoLinkUsuario> {
  if (!ENV.TELEGRAM_BOT_USERNAME) {
    return { error: 'TELEGRAM_BOT_USERNAME no está configurado en el servidor.', status: 400 };
  }

  const usuario = await buscarUsuarioActivo(usuarioId);
  if ('error' in usuario) return usuario;

  // Un solo token vigente por usuario.
  await invalidarTokensPendientes(usuarioId);

  const token = generarToken();
  const expiraEn = calcularExpiracionUsuario();
  const { error } = await supabaseAdmin.from('telegram_link_tokens').insert({
    entidad_tipo: 'usuario',
    entidad_id: usuarioId,
    token,
    expires_at: expiraEn,
  });
  if (error) {
    // La restricción CHECK de entidad_tipo aún no admite 'usuario' si falta la migración.
    const migracionPendiente = esObjetoInexistente(error) || error.code === '23514';
    return migracionPendiente
      ? { error: MENSAJE_MIGRACION_PENDIENTE, status: 409 }
      : { error: 'No se pudo generar el enlace de Telegram.', status: 500 };
  }

  return { deepLink: construirDeepLink(ENV.TELEGRAM_BOT_USERNAME, token), expiraEn };
}

export async function desvincularTelegramUsuario(usuarioId: string): Promise<ResultadoDesvinculo> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .update({ telegram_chat_id: null, telegram_linked_at: null })
    .eq('id', usuarioId)
    .select('id')
    .maybeSingle();
  if (error) {
    return esObjetoInexistente(error)
      ? { error: MENSAJE_MIGRACION_PENDIENTE, status: 409 }
      : { error: 'No se pudo desvincular el Telegram.', status: 500 };
  }
  if (!data) return { error: 'Usuario no encontrado.', status: 404 };

  // Un enlace pendiente no debe poder re-vincular lo recién desvinculado.
  await invalidarTokensPendientes(usuarioId);
  return { ok: true };
}
