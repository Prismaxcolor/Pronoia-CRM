/** Acceso real a la red para el motor de la cola: envío de la operación y subida de fotos.
 *  El `fetch` y el token se inyectan para poder probarlo en node. Un fallo de red LANZA; una
 *  respuesta HTTP (aunque sea 4xx/5xx) se devuelve con su estado. */
import type { RespuestaHttp, ResultadoSubida } from './cola-motor';
import { motivoDestinoNoPermitido, motivoOperacionNoPermitida } from './cola-seguridad';

export const TIMEOUT_ENVIO_MS = 30_000;
export const TIMEOUT_SUBIDA_FOTO_MS = 60_000;
const ENDPOINT_SUBIDA_FOTOS = '/api/uploads/tickets';

export interface DepsRed {
  apiUrl: string;
  fetchFn: typeof fetch;
  leerToken(): string | null;
  /** Informa al monitor de conexión (true = hubo respuesta del servidor). */
  reportar?(huboRespuesta: boolean): void;
}

async function conTimeout(deps: DepsRed, url: string, init: RequestInit, ms: number): Promise<Response> {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), ms);
  try {
    const resp = await deps.fetchFn(url, { ...init, signal: control.signal });
    deps.reportar?.(![502, 503, 504].includes(resp.status));
    return resp;
  } catch (e) {
    deps.reportar?.(false);
    throw e;
  } finally {
    clearTimeout(temporizador);
  }
}

function cabeceras(deps: DepsRed, json: boolean): Record<string, string> {
  const token = deps.leerToken();
  return { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function leerCuerpo(resp: Response): Promise<unknown> {
  const texto = await resp.text();
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

/** Estado con el que se rechaza, SIN enviar nada, una operación cuyo destino no pasa la lista blanca. */
export const STATUS_BLOQUEO_SEGURIDAD = 400;

export function crearEnviador(deps: DepsRed) {
  return async (p: { tipo?: string; metodo: string; endpoint: string; payload: unknown }): Promise<RespuestaHttp> => {
    // Defensa en profundidad: el token solo viaja a un endpoint permitido del mismo origen que la API.
    const bloqueo = motivoOperacionNoPermitida(p.tipo ?? '', p.metodo, p.endpoint) ?? motivoDestinoNoPermitido(deps.apiUrl, p.endpoint);
    if (bloqueo) {
      return { status: STATUS_BLOQUEO_SEGURIDAD, cuerpo: { error: `Operación bloqueada por seguridad: ${bloqueo}. No se envió.` } };
    }
    const resp = await conTimeout(deps, `${deps.apiUrl}${p.endpoint}`, {
      method: p.metodo,
      headers: cabeceras(deps, true),
      body: p.payload !== undefined && p.metodo !== 'DELETE' ? JSON.stringify(p.payload) : undefined,
    }, TIMEOUT_ENVIO_MS);
    return { status: resp.status, cuerpo: await leerCuerpo(resp) };
  };
}

export function crearSubidorFotos(deps: DepsRed) {
  return async (archivo: File): Promise<ResultadoSubida> => {
    const datos = new FormData();
    datos.append('file', archivo);
    const resp = await conTimeout(deps, `${deps.apiUrl}${ENDPOINT_SUBIDA_FOTOS}`, {
      method: 'POST',
      headers: cabeceras(deps, false),
      body: datos,
    }, TIMEOUT_SUBIDA_FOTO_MS);
    const cuerpo = (await leerCuerpo(resp)) as { url?: unknown; error?: unknown } | null;
    if (resp.ok && typeof cuerpo?.url === 'string') return { ok: true, url: cuerpo.url };
    const mensaje = typeof cuerpo?.error === 'string' ? cuerpo.error : `Error ${resp.status}`;
    // Un 2xx sin URL es una respuesta inservible: se trata como fallo reintentable del servidor.
    return { ok: false, status: resp.ok ? 502 : resp.status, mensaje };
  };
}

/** Id del usuario (claim `sub`) de un JWT, o null si no se puede leer. */
export function usuarioDeToken(token: string | null): string | null {
  if (!token) return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  try {
    const base64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
    const relleno = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const carga = JSON.parse(atob(relleno)) as { sub?: unknown };
    return typeof carga.sub === 'string' && carga.sub ? carga.sub : null;
  } catch {
    return null;
  }
}
