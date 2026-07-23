import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { ENV } from '../config/env.js';

export type EntidadTelegram = 'proveedor' | 'cliente';

const TABLA: Record<EntidadTelegram, string> = {
  proveedor: 'proveedores',
  cliente: 'clientes',
};

const NOMBRE_ENTIDAD: Record<EntidadTelegram, string> = {
  proveedor: 'Proveedor',
  cliente: 'Cliente',
};

const TOKEN_TTL_HORAS = 48;

export function generarToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function calcularExpiracion(desde: Date = new Date()): string {
  return new Date(desde.getTime() + TOKEN_TTL_HORAS * 60 * 60 * 1000).toISOString();
}

export function construirDeepLink(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=${token}`;
}

export async function generarLinkTelegram(
  entidadTipo: EntidadTelegram,
  entidadId: string
): Promise<{ deepLink: string } | { error: string }> {
  if (!ENV.TELEGRAM_BOT_USERNAME) {
    return { error: 'TELEGRAM_BOT_USERNAME no está configurado en el servidor.' };
  }

  const { data: entidad, error: errorEntidad } = await supabaseAdmin
    .from(TABLA[entidadTipo])
    .select('id')
    .eq('id', entidadId)
    .maybeSingle();

  if (errorEntidad) return { error: errorEntidad.message };
  if (!entidad) return { error: `${NOMBRE_ENTIDAD[entidadTipo]} no encontrado.` };

  // Invalidar links pendientes anteriores de la misma entidad — evita tener varios
  // tokens válidos al mismo tiempo si se genera el link más de una vez.
  await supabaseAdmin
    .from('telegram_link_tokens')
    .update({ usado: true })
    .eq('entidad_tipo', entidadTipo)
    .eq('entidad_id', entidadId)
    .eq('usado', false);

  const token = generarToken();

  const { error: errorToken } = await supabaseAdmin.from('telegram_link_tokens').insert({
    entidad_tipo: entidadTipo,
    entidad_id: entidadId,
    token,
    expires_at: calcularExpiracion(),
  });

  if (errorToken) return { error: errorToken.message };

  return { deepLink: construirDeepLink(ENV.TELEGRAM_BOT_USERNAME, token) };
}
