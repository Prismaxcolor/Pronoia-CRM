/** Lógica pura de la sesión local (sin React, sin IndexedDB, sin `window`).
 *  Decide si se puede seguir trabajando sin red con la última sesión verificada. */

/** Máximo sin revalidar con el servidor para seguir usando la sesión local. */
export const MAX_SIN_VERIFICAR_MS = 7 * 24 * 60 * 60 * 1000;
/** Si el reloj va más atrás que la última verificación por más que esto, se considera desfasado. */
export const TOLERANCIA_RELOJ_MS = 5 * 60 * 1000;
export const VERSION_SESION = 1;

/** Usuario guardado: solo lo que la app necesita para pintar la UI y calcular permisos. */
export interface UsuarioLocal {
  id: string;
  nombre: string;
  rol: string;
  permisos: unknown[];
  temaMarca?: string | null;
}

export interface SesionLocal<U = UsuarioLocal> {
  v: number;
  usuario: U;
  token: string;
  /** Expiración del JWT en ms epoch (decodificada en el cliente, sin verificar firma). */
  expiraEn: number | null;
  ultimaVerificacion: number;
  /** Último valor conocido del interruptor del servidor. */
  offlineActivo: boolean;
  /** Servidor menos dispositivo (ms) en la última verificación; informativo. */
  desfaseRelojMs?: number;
  /** El usuario configuró un PIN: si luego falta su registro, NO se desbloquea automáticamente. */
  pinActivo?: boolean;
}

export type MotivoNoVigente = 'caducada' | 'token-vencido' | 'reloj' | 'apagado' | 'token-distinto' | 'invalida';
export type Vigencia = { vigente: true } | { vigente: false; motivo: MotivoNoVigente };

/** Decodifica el `exp` (segundos) de un JWT a ms epoch. null si no se puede (token opaco o dañado). */
export function decodificarExpiracion(token: string): number | null {
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  try {
    const base64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
    const relleno = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const carga = JSON.parse(atob(relleno)) as { exp?: unknown };
    return typeof carga.exp === 'number' && Number.isFinite(carga.exp) ? carga.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function esSesionLocalValida(valor: unknown): valor is SesionLocal {
  if (typeof valor !== 'object' || valor === null) return false;
  const s = valor as Partial<SesionLocal>;
  const u = s.usuario as Partial<UsuarioLocal> | undefined;
  return s.v === VERSION_SESION
    && typeof s.token === 'string' && s.token.length > 0
    && typeof s.ultimaVerificacion === 'number'
    && typeof s.offlineActivo === 'boolean'
    && (s.expiraEn === null || typeof s.expiraEn === 'number')
    && typeof u === 'object' && u !== null
    && typeof u.id === 'string' && typeof u.rol === 'string' && Array.isArray(u.permisos);
}

/** ¿Se puede usar la sesión local ahora? `tokenActual` es el token que hay en el almacenamiento de
 *  la app: si difiere del guardado, la sesión local es de otro inicio de sesión y no se usa. */
export function evaluarVigencia(
  sesion: SesionLocal | null,
  ahora: number,
  tokenActual: string | null,
  maxSinVerificarMs: number = MAX_SIN_VERIFICAR_MS,
): Vigencia {
  if (!sesion || !esSesionLocalValida(sesion)) return { vigente: false, motivo: 'invalida' };
  if (!sesion.offlineActivo) return { vigente: false, motivo: 'apagado' };
  if (tokenActual !== null && tokenActual !== sesion.token) return { vigente: false, motivo: 'token-distinto' };
  if (ahora < sesion.ultimaVerificacion - TOLERANCIA_RELOJ_MS) return { vigente: false, motivo: 'reloj' };
  if (sesion.expiraEn !== null && ahora >= sesion.expiraEn) return { vigente: false, motivo: 'token-vencido' };
  if (ahora - sesion.ultimaVerificacion >= maxSinVerificarMs) return { vigente: false, motivo: 'caducada' };
  return { vigente: true };
}

/** Valor del interruptor OFFLINE_ACTIVO. Falla CERRADO: sin dato del servidor solo se hereda el último valor
 *  conocido DEL MISMO usuario; si no lo hay (o era de otro usuario) queda apagado. */
export function resolverOfflineActivo(
  activoServidor: boolean | undefined | null,
  previa: { usuario: { id: string }; offlineActivo: boolean } | null,
  usuarioId: string,
): boolean {
  if (typeof activoServidor === 'boolean') return activoServidor;
  return previa !== null && previa.usuario.id === usuarioId ? previa.offlineActivo : false;
}

export function mensajeNoVigente(motivo: MotivoNoVigente): string {
  switch (motivo) {
    case 'reloj': return 'La fecha de tu equipo parece incorrecta. Conéctate a internet para continuar.';
    case 'caducada':
    case 'token-vencido': return 'Tu sesión local caducó. Conéctate a internet para volver a validarla; tus datos pendientes no se pierden.';
    default: return 'No se puede abrir sin conexión. Conéctate a internet para continuar.';
  }
}

export type ClaseFalloSesion = 'sesion-invalida' | 'sin-servidor';

/** Clasifica el fallo de /api/auth/me: SOLO 401/403/404 (token inválido, prohibido, usuario inexistente o
 *  desactivado) cierran la sesión. Cualquier otra cosa (sin red, timeout, 5xx, 429) se trata como
 *  "sin servidor" y la sesión se conserva. */
export function clasificarFalloSesion(err: unknown): ClaseFalloSesion {
  const status = typeof err === 'object' && err !== null ? (err as { status?: unknown }).status : undefined;
  return status === 401 || status === 403 || status === 404 ? 'sesion-invalida' : 'sin-servidor';
}

export type DecisionArranque<U = UsuarioLocal> =
  | { accion: 'online'; usuario: U }
  | { accion: 'offline'; sesion: SesionLocal<U> }
  | { accion: 'cerrar' }
  /** Hay token pero no se puede validar ni usar sesión local: no se muestra la app, pero NO se borra nada. */
  | { accion: 'sin-usuario'; motivo: MotivoNoVigente };

export type ResultadoMe<U> = { ok: true; usuario: U } | { ok: false; error: unknown };

/** Qué hacer al abrir la app con un token guardado, según lo que respondió /me y la sesión local. */
export function decidirArranque<U>(
  resultado: ResultadoMe<U>,
  sesionLocal: SesionLocal<U> | null,
  ahora: number,
  tokenActual: string | null,
  maxSinVerificarMs: number = MAX_SIN_VERIFICAR_MS,
): DecisionArranque<U> {
  if (resultado.ok) return { accion: 'online', usuario: resultado.usuario };
  if (clasificarFalloSesion(resultado.error) === 'sesion-invalida') return { accion: 'cerrar' };
  const vigencia = evaluarVigencia(sesionLocal as SesionLocal | null, ahora, tokenActual, maxSinVerificarMs);
  if (!vigencia.vigente) return { accion: 'sin-usuario', motivo: vigencia.motivo };
  return { accion: 'offline', sesion: sesionLocal as SesionLocal<U> };
}
