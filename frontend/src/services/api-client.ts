import { borrarTodosLosBorradores } from '../lib/borrador';
import { reportarResultadoRed } from '../lib/offline/conexion';
import { iniciarTrabajoEnVuelo } from '../lib/trabajo-en-vuelo';

export { esErrorDeRed } from '../lib/offline/conexion';

const API_URL =import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'pronoia_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
}

/** `remember=true` (default) persiste el token entre sesiones del navegador
 *  (localStorage). `remember=false` lo guarda solo para la pestaña actual
 *  (sessionStorage), para el checkbox "Recordarme" del login. */
export function setToken(token: string, remember = true): void {
  const [activo, otro] = remember ? [localStorage, sessionStorage] : [sessionStorage, localStorage];
  activo.setItem(TOKEN_KEY, token);
  otro.removeItem(TOKEN_KEY);
}

/** true si la sesión es solo de esta pestaña (token en sessionStorage, el usuario
 *  no marcó "Recordarme"): sus borradores de formularios también deben serlo. */
export function tokenEsDeSesion(): boolean {
  return localStorage.getItem(TOKEN_KEY) === null && sessionStorage.getItem(TOKEN_KEY) !== null;
}

/** Cierra la sesión local quitando SOLO el token. No toca borradores de formularios, fotos ni la cola de
 *  pendientes: eso es trabajo del usuario que nunca se pierde por cerrar o vencer la sesión. El borrado
 *  de borradores es explícito (ver `borrarBorradoresLocales`) y siempre con confirmación. */
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

/** Borra los borradores de formularios (y sus fotos) de este equipo. Solo tras confirmación explícita. */
export function borrarBorradoresLocales(): void {
  borrarTodosLosBorradores();
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  /** Corta la petición si no responde a tiempo (el error resultante es de red: `esErrorDeRed`). */
  timeoutMs?: number;
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (opts.auth !== false) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const resp = await enviar(`${API_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  }, opts.timeoutMs);

  const text = await resp.text();
  const data = text ? safeParse(text) : null;

  if (!resp.ok) {
    const body = data as
      | { error?: string; detalles?: Array<{ campo?: string; mensaje?: string }> }
      | null;
    let msg = body?.error ?? `Error ${resp.status}`;
    if (body?.detalles?.length) {
      const dets = body.detalles
        .map(d => (d.campo && d.campo !== '(raíz)' ? `${d.campo}: ${d.mensaje}` : d.mensaje))
        .filter(Boolean)
        .join(' · ');
      if (dets) msg = `${msg} (${dets})`;
    }
    throw new ApiError(msg, resp.status);
  }

  return data as T;
}

/** fetch con timeout opcional. Informa al monitor de conexión: un fallo de red lo marca sin conexión al
 *  instante; cualquier respuesta HTTP (aunque sea 4xx) lo marca en línea. */
async function enviar(url: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
  // Las peticiones que escriben cuentan como envío en vuelo: la app no se recarga a mitad.
  const terminarEnvio = init.method && init.method !== 'GET' ? iniciarTrabajoEnVuelo('envio') : null;
  const control = timeoutMs ? new AbortController() : null;
  const temporizador = control ? setTimeout(() => control.abort(), timeoutMs) : null;
  try {
    const resp = await fetch(url, control ? { ...init, signal: control.signal } : init);
    reportarResultadoRed(![502, 503, 504].includes(resp.status));
    return resp;
  } catch (err) {
    reportarResultadoRed(false);
    throw err;
  } finally {
    if (temporizador) clearTimeout(temporizador);
    terminarEnvio?.();
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
