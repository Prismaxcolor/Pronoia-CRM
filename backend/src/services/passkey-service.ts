import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransport,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { supabaseAdmin } from '../config/supabase.js';
import { ENV } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { sesionPorUserId, obtenerUsuarioPorId, verificarPasswordUsuario, type AuthResult } from './auth-service.js';

/** Espejo de shared/types/passkey.ts (el backend no importa de shared por el rootDir). */
export interface PasskeyResumen {
  id: string;
  nombre: string;
  creadoEn: string;
  ultimoUso: string | null;
}

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const MAX_PASSKEYS_POR_USUARIO = 20;
/** Tope global de challenges de login vigentes (anonimos): frena el llenado de la tabla. */
export const MAX_CHALLENGES_LOGIN_VIGENTES = 2000;
/** Probabilidad de limpiar challenges vencidos al crear uno nuevo (en vez de hacerlo en cada request). */
const PROBABILIDAD_LIMPIEZA = 0.05;
const NOMBRE_POR_DEFECTO = 'Passkey';
const ORIGEN_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

interface PasskeyRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string[] | null;
  nombre: string;
  creado_en: string;
  ultimo_uso: string | null;
}

interface ChallengeRow {
  challenge: string;
  user_id: string | null;
  expira_en: string;
}

type TipoChallenge = 'registro' | 'login';

export interface ContextoRp {
  rpID: string;
  origin: string;
}

/**
 * Deriva rpID y origin del header Origin SOLO si ese origin está permitido
 * (WEBAUTHN_ORIGINS o, si no hay, CORS_ORIGINS; en desarrollo sin lista, cualquier localhost).
 * Devuelve null si el origin falta, no es válido o no está permitido.
 */
export function resolverRp(originHeader: string | undefined): ContextoRp | null {
  if (!originHeader) return null;
  let url: URL;
  try {
    url = new URL(originHeader);
  } catch {
    return null;
  }
  if (url.origin !== originHeader) return null;

  const base = ENV.WEBAUTHN_ORIGINS.length > 0 ? ENV.WEBAUTHN_ORIGINS : ENV.CORS_ORIGINS;
  // Solo https (o localhost): en produccion sin ningun origen https las passkeys quedan deshabilitadas.
  const lista = base.filter(o => o.startsWith('https://') || ORIGEN_LOCAL.test(o));
  const permitido =
    lista.includes(originHeader) ||
    (base.length === 0 && ENV.NODE_ENV !== 'production' && ORIGEN_LOCAL.test(originHeader));
  if (!permitido) return null;

  const host = url.hostname;
  if (ENV.WEBAUTHN_RP_ID) {
    const rp = ENV.WEBAUTHN_RP_ID;
    if (host !== rp && !host.endsWith(`.${rp}`)) return null;
    return { rpID: rp, origin: originHeader };
  }
  return { rpID: host, origin: originHeader };
}

// --- Challenges (tabla, un solo uso, vencen en 5 min) -----------------------------

async function limpiarChallengesVencidos(): Promise<void> {
  await supabaseAdmin.from('passkey_challenges').delete().lt('expira_en', new Date().toISOString());
}

async function crearChallenge(tipo: TipoChallenge, challenge: string, userId: string | null): Promise<string | null> {
  // Limpieza oportunista de vencidos, solo de vez en cuando (no bloquea si falla).
  if (Math.random() < PROBABILIDAD_LIMPIEZA) await limpiarChallengesVencidos();

  const { data, error } = await supabaseAdmin
    .from('passkey_challenges')
    .insert({
      challenge,
      user_id: userId,
      tipo,
      expira_en: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    })
    .select('id')
    .single();
  if (error || !data) {
    logger.error({ evento: 'passkey_challenge_error', mensaje: error?.message });
    return null;
  }
  return (data as { id: string }).id;
}

/** Borra y devuelve la fila: el challenge se consume aunque haya vencido (nunca se reutiliza). */
function validarVigencia(filas: ChallengeRow[] | null): ChallengeRow | null {
  const fila = filas?.[0];
  if (!fila) return null;
  if (new Date(fila.expira_en).getTime() <= Date.now()) return null;
  return fila;
}

export async function consumirChallengePorId(id: string, tipo: TipoChallenge): Promise<ChallengeRow | null> {
  const { data } = await supabaseAdmin
    .from('passkey_challenges')
    .delete()
    .eq('id', id)
    .eq('tipo', tipo)
    .select('challenge, user_id, expira_en');
  return validarVigencia(data as ChallengeRow[] | null);
}

async function consumirChallengeRegistro(challenge: string, userId: string): Promise<ChallengeRow | null> {
  const { data } = await supabaseAdmin
    .from('passkey_challenges')
    .delete()
    .eq('challenge', challenge)
    .eq('tipo', 'registro')
    .eq('user_id', userId)
    .select('challenge, user_id, expira_en');
  return validarVigencia(data as ChallengeRow[] | null);
}

/** Extrae el challenge firmado por el navegador (clientDataJSON.challenge). */
export function challengeDeRespuesta(respuesta: { response?: { clientDataJSON?: unknown } }): string | null {
  const cdj = respuesta.response?.clientDataJSON;
  if (typeof cdj !== 'string') return null;
  try {
    const parsed = JSON.parse(Buffer.from(cdj, 'base64url').toString('utf8')) as { challenge?: unknown };
    return typeof parsed.challenge === 'string' ? parsed.challenge : null;
  } catch {
    return null;
  }
}

function transportsDe(row: PasskeyRow): AuthenticatorTransport[] {
  return (row.transports ?? []) as AuthenticatorTransport[];
}

function aResumen(row: PasskeyRow): PasskeyResumen {
  return { id: row.id, nombre: row.nombre, creadoEn: row.creado_en, ultimoUso: row.ultimo_uso };
}

// --- Registro --------------------------------------------------------------------

export type ErrorPasskey = 'origen' | 'invalido' | 'limite' | 'interno' | 'saturado' | 'password';

export async function opcionesRegistro(
  userId: string,
  originHeader: string | undefined,
  password: string,
): Promise<{ opciones: PublicKeyCredentialCreationOptionsJSON } | { error: ErrorPasskey }> {
  const rp = resolverRp(originHeader);
  if (!rp) return { error: 'origen' };
  if (!(await verificarPasswordUsuario(userId, password))) return { error: 'password' };

  const usuario = await obtenerUsuarioPorId(userId);
  if (!usuario) return { error: 'invalido' };

  const { data: existentes } = await supabaseAdmin
    .from('passkeys')
    .select('credential_id, transports')
    .eq('user_id', userId);
  const filas = (existentes ?? []) as Pick<PasskeyRow, 'credential_id' | 'transports'>[];
  if (filas.length >= MAX_PASSKEYS_POR_USUARIO) return { error: 'limite' };

  const opciones = await generateRegistrationOptions({
    rpName: ENV.WEBAUTHN_RP_NAME,
    rpID: rp.rpID,
    userID: new TextEncoder().encode(usuario.id),
    userName: usuario.email,
    userDisplayName: usuario.nombre,
    attestationType: 'none',
    excludeCredentials: filas.map(f => ({
      id: f.credential_id,
      transports: (f.transports ?? []) as AuthenticatorTransport[],
    })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });

  const guardado = await crearChallenge('registro', opciones.challenge, userId);
  if (!guardado) return { error: 'interno' };
  return { opciones };
}

export async function verificarRegistro(
  userId: string,
  originHeader: string | undefined,
  respuesta: RegistrationResponseJSON,
  nombre?: string,
): Promise<{ passkey: PasskeyResumen } | { error: ErrorPasskey }> {
  const rp = resolverRp(originHeader);
  if (!rp) return { error: 'origen' };

  const challengeFirmado = challengeDeRespuesta(respuesta);
  if (!challengeFirmado) return { error: 'invalido' };
  const challenge = await consumirChallengeRegistro(challengeFirmado, userId);
  if (!challenge) return { error: 'invalido' };

  let info;
  try {
    const verificacion = await verifyRegistrationResponse({
      response: respuesta,
      expectedChallenge: challenge.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
    if (!verificacion.verified) return { error: 'invalido' };
    info = verificacion.registrationInfo;
  } catch {
    return { error: 'invalido' };
  }
  if (!info) return { error: 'invalido' };

  const { data, error } = await supabaseAdmin
    .from('passkeys')
    .insert({
      user_id: userId,
      credential_id: info.credential.id,
      public_key: Buffer.from(info.credential.publicKey).toString('base64url'),
      counter: info.credential.counter,
      transports: info.credential.transports ?? [],
      nombre: nombre?.trim() || NOMBRE_POR_DEFECTO,
    })
    .select('*')
    .single();
  if (error || !data) {
    logger.warn({ evento: 'passkey_registro_fallido', userId, mensaje: error?.message });
    return { error: 'invalido' };
  }

  const row = data as PasskeyRow;
  logger.info({ evento: 'passkey_registrada', userId, passkeyId: row.id });
  return { passkey: aResumen(row) };
}

// --- Listado y borrado -------------------------------------------------------------

export async function listarPasskeys(userId: string): Promise<PasskeyResumen[]> {
  const { data, error } = await supabaseAdmin
    .from('passkeys')
    .select('*')
    .eq('user_id', userId)
    .order('creado_en', { ascending: true });
  if (error || !data) return [];
  return (data as PasskeyRow[]).map(aResumen);
}

/** Solo borra passkeys del propio usuario. Devuelve false si no existe o es ajena. */
export async function borrarPasskey(userId: string, id: string, password: string): Promise<boolean | 'password'> {
  if (!(await verificarPasswordUsuario(userId, password))) return 'password';
  const { data, error } = await supabaseAdmin
    .from('passkeys')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id');
  if (error || !data || data.length === 0) return false;
  logger.info({ evento: 'passkey_eliminada', userId, passkeyId: id });
  return true;
}

/** Revoca todas las passkeys del usuario (al cambiar/resetear su contrasena). Nunca lanza. */
export async function borrarPasskeysDeUsuario(userId: string, motivo: string): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin.from('passkeys').delete().eq('user_id', userId).select('id');
    if (error) {
      logger.error({ evento: 'passkeys_revocacion_fallida', userId, motivo, mensaje: error.message });
      return;
    }
    if (data && data.length > 0) {
      logger.info({ evento: 'passkeys_revocadas', userId, motivo, cantidad: data.length });
    }
  } catch (err) {
    logger.error({ evento: 'passkeys_revocacion_fallida', userId, motivo, mensaje: String(err) });
  }
}

// --- Login -----------------------------------------------------------------------------

export async function opcionesLogin(
  originHeader: string | undefined,
): Promise<{ opciones: PublicKeyCredentialRequestOptionsJSON; loginId: string } | { error: ErrorPasskey }> {
  const rp = resolverRp(originHeader);
  if (!rp) return { error: 'origen' };

  const { count } = await supabaseAdmin
    .from('passkey_challenges')
    .select('id', { count: 'exact', head: true })
    .eq('tipo', 'login')
    .gt('expira_en', new Date().toISOString());
  if ((count ?? 0) >= MAX_CHALLENGES_LOGIN_VIGENTES) {
    logger.warn({ evento: 'passkey_challenges_saturados' });
    return { error: 'saturado' };
  }

  const opciones = await generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: 'required',
  });
  const loginId = await crearChallenge('login', opciones.challenge, null);
  if (!loginId) return { error: 'interno' };
  return { opciones, loginId };
}

/** Devuelve la sesión (igual que login()) o null ante cualquier fallo. */
export async function verificarLogin(
  originHeader: string | undefined,
  loginId: string,
  respuesta: AuthenticationResponseJSON,
): Promise<AuthResult | null> {
  const rp = resolverRp(originHeader);
  if (!rp) return null;

  const challenge = await consumirChallengePorId(loginId, 'login');
  if (!challenge) return null;

  const { data } = await supabaseAdmin
    .from('passkeys')
    .select('*')
    .eq('credential_id', respuesta.id)
    .maybeSingle();
  if (!data) return null;
  const row = data as PasskeyRow;

  let nuevoCounter: number;
  try {
    const verificacion = await verifyAuthenticationResponse({
      response: respuesta,
      expectedChallenge: challenge.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
      credential: {
        id: row.credential_id,
        publicKey: new Uint8Array(Buffer.from(row.public_key, 'base64url')),
        counter: Number(row.counter),
        transports: transportsDe(row),
      },
    });
    if (!verificacion.verified) return null;
    nuevoCounter = verificacion.authenticationInfo.newCounter;
  } catch {
    return null;
  }

  // El usuario debe seguir activo antes de tocar nada.
  const sesion = await sesionPorUserId(row.user_id);
  if (!sesion) return null;

  // Compare-and-set sobre el counter: dos usos simultáneos de la misma firma no pasan ambos.
  const { data: actualizadas } = await supabaseAdmin
    .from('passkeys')
    .update({ counter: nuevoCounter, ultimo_uso: new Date().toISOString() })
    .eq('id', row.id)
    .eq('counter', row.counter)
    .select('id');
  if (!actualizadas || actualizadas.length === 0) return null;

  return sesion;
}
