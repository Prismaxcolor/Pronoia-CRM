import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/browser';
import type { PasskeyResumen } from '@shared/types/passkey.js';
import { apiFetch } from './api-client';
import { separarOpcionesLogin } from '../lib/passkey-logica';

export { browserSupportsWebAuthn };

/** Lo que el servidor devuelve al iniciar sesión con contraseña o passkey (lo consume el AuthProvider). */
export interface RespuestaLoginPasskey {
  token: string;
  usuario: unknown;
}

export async function listarPasskeys(): Promise<PasskeyResumen[]> {
  const { passkeys } = await apiFetch<{ passkeys: PasskeyResumen[] }>('/api/auth/passkeys');
  return passkeys;
}

/** Exige la contraseña actual; si es incorrecta el servidor responde 403 "Contraseña incorrecta". */
export async function eliminarPasskey(id: string, password: string): Promise<void> {
  await apiFetch<{ ok: true }>(`/api/auth/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE', body: { password } });
}

/** Ceremonia completa de registro: pide opciones, abre el diálogo del dispositivo y verifica en el servidor. */
export async function registrarPasskey(password: string, nombre?: string): Promise<PasskeyResumen> {
  const optionsJSON = await apiFetch<PublicKeyCredentialCreationOptionsJSON>('/api/auth/passkey/register/options', {
    method: 'POST',
    body: { password },
  });
  const respuesta: RegistrationResponseJSON = await startRegistration({ optionsJSON });
  const { passkey } = await apiFetch<{ passkey: PasskeyResumen }>('/api/auth/passkey/register/verify', {
    method: 'POST',
    body: { respuesta, nombre },
  });
  return passkey;
}

/** Ceremonia completa de login con passkey (sin sesión previa). */
export async function entrarConPasskey(): Promise<RespuestaLoginPasskey> {
  const bruto = await apiFetch<PublicKeyCredentialRequestOptionsJSON & { loginId: string }>('/api/auth/passkey/login/options', {
    method: 'POST',
    auth: false,
  });
  const { loginId, opciones } = separarOpcionesLogin(bruto);
  const respuesta: AuthenticationResponseJSON = await startAuthentication({
    optionsJSON: opciones as PublicKeyCredentialRequestOptionsJSON,
  });
  return apiFetch<RespuestaLoginPasskey>('/api/auth/passkey/login/verify', {
    method: 'POST',
    body: { loginId, respuesta },
    auth: false,
  });
}
