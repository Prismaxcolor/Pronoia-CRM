/**
 * Lógica pura de passkeys (sin dependencias del navegador ni de la librería WebAuthn) para poder probarla aislada.
 * Traduce los errores de la ceremonia WebAuthn a mensajes en español y separa la respuesta de opciones de login.
 */

export type TipoErrorPasskey = 'cancelado' | 'ya-registrada' | 'no-soportada' | 'otro';

export interface ErrorPasskeyClasificado {
  tipo: TipoErrorPasskey;
  /** Mensaje listo para mostrar; null cuando el usuario solo canceló y no hay nada que decir. */
  mensaje: string | null;
}

export const MENSAJE_PASSKEY_NO_SOPORTADA =
  'Este navegador o dispositivo no admite passkeys. Prueba con uno más reciente (Chrome, Safari, Edge o Firefox actualizados).';
export const MENSAJE_PASSKEY_YA_REGISTRADA = 'Este dispositivo ya tiene una passkey registrada para tu cuenta.';
export const MENSAJE_PASSKEY_REGISTRO_FALLIDO = 'No se pudo crear la passkey. Intenta de nuevo.';
export const MENSAJE_PASSKEY_LOGIN_FALLIDO = 'No se pudo entrar con la passkey. Intenta de nuevo o usa tu contraseña.';
export const LARGO_MAX_NOMBRE_PASSKEY = 60;

const CODIGOS_CANCELACION = new Set(['ERROR_CEREMONY_ABORTED']);
const NOMBRES_CANCELACION = new Set(['NotAllowedError', 'AbortError']);

function leerTexto(err: unknown, campo: 'name' | 'code'): string {
  if (typeof err !== 'object' || err === null) return '';
  const valor = (err as Record<string, unknown>)[campo];
  return typeof valor === 'string' ? valor : '';
}

/** Clasifica un error lanzado por startRegistration/startAuthentication (o por la API de red). */
export function clasificarErrorPasskey(err: unknown, mensajePorDefecto: string): ErrorPasskeyClasificado {
  const code = leerTexto(err, 'code');
  const name = leerTexto(err, 'name');
  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
    return { tipo: 'ya-registrada', mensaje: MENSAJE_PASSKEY_YA_REGISTRADA };
  }
  if (CODIGOS_CANCELACION.has(code) || NOMBRES_CANCELACION.has(name)) {
    return { tipo: 'cancelado', mensaje: null };
  }
  if (name === 'NotSupportedError' || code === 'ERROR_AUTHENTICATOR_NO_SUPPORTED_ALGORITHM') {
    return { tipo: 'no-soportada', mensaje: MENSAJE_PASSKEY_NO_SOPORTADA };
  }
  return { tipo: 'otro', mensaje: mensajePorDefecto };
}

/** Normaliza el nombre opcional de una passkey: sin espacios sobrantes y con tope de largo; undefined si queda vacío. */
export function normalizarNombrePasskey(nombre: string): string | undefined {
  const limpio = nombre.trim().replace(/\s+/g, ' ').slice(0, LARGO_MAX_NOMBRE_PASSKEY);
  return limpio === '' ? undefined : limpio;
}

/** Separa la respuesta de /login/options en las opciones WebAuthn y el identificador de la ceremonia. */
export function separarOpcionesLogin<T extends object>(respuesta: T & { loginId?: unknown }): { loginId: string; opciones: Omit<T, 'loginId'> } {
  const { loginId, ...opciones } = respuesta;
  if (typeof loginId !== 'string' || loginId === '') throw new Error('Respuesta de passkey inválida del servidor.');
  return { loginId, opciones };
}
