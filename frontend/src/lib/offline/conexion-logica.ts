/** Lógica pura de detección de conexión (sin React ni `window`): todo recibe sus
 *  dependencias para poder probarse en node. */

/** Códigos HTTP que indican que el servidor no es alcanzable (proxy/gateway/timeout), no un rechazo de negocio. */
const ESTADOS_SIN_SERVIDOR: ReadonlySet<number> = new Set([0, 408, 502, 503, 504]);

export const TIMEOUT_SONDA_MS = 4_000;

/** true si el error indica falta de red o de servidor alcanzable (reintentable): TypeError de fetch,
 *  timeout/abort, o un HTTP 0/408/502/503/504. Un error con respuesta del servidor (400, 401, 404, 409,
 *  422, 500…) NO es de red: el servidor contestó. `navigator.onLine === false` solo se usa para los errores
 *  que no traen respuesta del servidor. */
export function esErrorDeRed(err: unknown, navegadorOnline: boolean | undefined = leerNavigatorOnLine()): boolean {
  if (typeof err === 'object' && err !== null) {
    const { status, name } = err as { status?: unknown; name?: unknown };
    if (typeof status === 'number') return ESTADOS_SIN_SERVIDOR.has(status);
    if (name === 'AbortError' || name === 'TimeoutError') return true;
  }
  if (err instanceof TypeError) return true;
  return navegadorOnline === false && err instanceof Error;
}

function leerNavigatorOnLine(): boolean | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.onLine;
}

export type Sonda = (url: string, init: { method: 'HEAD'; cache: 'no-store'; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

/** Comprobación real y ligera: HEAD a la URL de salud con timeout. Cualquier respuesta HTTP (aunque sea
 *  5xx del propio servidor) cuenta como "hay red" salvo 502/503/504/408, que indican servidor inalcanzable. */
export async function comprobarConexion(
  url: string,
  sonda: Sonda,
  timeoutMs = TIMEOUT_SONDA_MS,
): Promise<boolean> {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), timeoutMs);
  try {
    const resp = await sonda(url, { method: 'HEAD', cache: 'no-store', signal: control.signal });
    return !ESTADOS_SIN_SERVIDOR.has(resp.status);
  } catch {
    return false;
  } finally {
    clearTimeout(temporizador);
  }
}

export interface EstadoConexion {
  online: boolean;
  /** Momento (ms epoch) en que se entró en el estado actual. */
  desde: number;
}

/** Almacén mínimo observable (compatible con useSyncExternalStore). Solo emite cuando el valor cambia. */
export interface AlmacenConexion {
  obtener(): EstadoConexion;
  fijar(online: boolean): void;
  suscribir(oyente: () => void): () => void;
}

export function crearAlmacenConexion(inicialOnline: boolean, ahora: () => number = Date.now): AlmacenConexion {
  let estado: EstadoConexion = { online: inicialOnline, desde: ahora() };
  const oyentes = new Set<() => void>();
  return {
    obtener: () => estado,
    fijar(online) {
      if (online === estado.online) return;
      estado = { online, desde: ahora() };
      oyentes.forEach(o => o());
    },
    suscribir(oyente) {
      oyentes.add(oyente);
      return () => { oyentes.delete(oyente); };
    },
  };
}
