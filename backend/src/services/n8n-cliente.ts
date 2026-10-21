import { ENV } from '../config/env.js';
import { cabecerasWebhookN8n } from '../utils/n8n-headers.js';

/** Webhook de n8n al que va un aviso. Se guarda en la cola como texto: la URL se resuelve al enviar. */
export type DestinoN8n = 'contenido' | 'grupo';

export const TIMEOUT_N8N_MS = 10_000;
export const MAX_INTENTOS_INMEDIATOS = 3;
/** Con timeout largo (álbumes de fotos) solo se reintenta una vez: tres esperas de 30 s no caben en una función serverless. */
export const MAX_INTENTOS_TIMEOUT_LARGO = 2;
/** Espera antes del reintento 2 y 3. Corta: el request del usuario puede estar esperando. */
const BACKOFF_INMEDIATO_MS = [400, 1_200] as const;
const STATUS_TRANSITORIOS = new Set([408, 425, 429]);

export interface ResultadoN8n {
  ok: boolean;
  /** Último status HTTP recibido; null si no hubo respuesta (red/timeout). */
  status: number | null;
  intentos: number;
  /** El fallo (si lo hubo) puede resolverse reintentando más tarde: red, timeout, 5xx, 408/425/429. */
  transitorio: boolean;
  error?: string;
}

export interface OpcionesEnvioN8n {
  timeoutMs?: number;
  maxIntentos?: number;
  /** Para tests. */
  esperar?: (ms: number) => Promise<void>;
}

export function urlDeDestino(destino: DestinoN8n): string {
  return destino === 'grupo' ? ENV.N8N_WEBHOOK_GRUPO : ENV.N8N_WEBHOOK_ENVIAR_CONTENIDO;
}

const esperarMs = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export function esStatusTransitorio(status: number): boolean {
  return status >= 500 || STATUS_TRANSITORIOS.has(status);
}

type Intento = Omit<ResultadoN8n, 'intentos'>;

async function intentarUnaVez(url: string, cuerpo: string, timeoutMs: number): Promise<Intento> {
  try {
    const respuesta = await fetch(url, {
      method: 'POST',
      headers: await cabecerasWebhookN8n(),
      body: cuerpo,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (respuesta.ok) return { ok: true, status: respuesta.status, transitorio: false };
    return {
      ok: false,
      status: respuesta.status,
      transitorio: esStatusTransitorio(respuesta.status),
      error: `n8n respondió ${respuesta.status}`,
    };
  } catch (err) {
    return { ok: false, status: null, transitorio: true, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * POST JSON a un webhook de n8n con timeout. Reintenta con backoff corto SOLO fallos transitorios
 * (red, timeout, 5xx, 408/425/429); un 4xx corta de inmediato. Nunca lanza.
 * Ojo: tras un timeout n8n pudo haber recibido el aviso, así que un reintento puede duplicarlo.
 */
export async function enviarN8n(
  url: string,
  cuerpo: Record<string, unknown>,
  opciones: OpcionesEnvioN8n = {}
): Promise<ResultadoN8n> {
  const { timeoutMs = TIMEOUT_N8N_MS, esperar = esperarMs } = opciones;
  const maxIntentos =
    opciones.maxIntentos ?? (timeoutMs > TIMEOUT_N8N_MS ? MAX_INTENTOS_TIMEOUT_LARGO : MAX_INTENTOS_INMEDIATOS);
  const json = JSON.stringify(cuerpo);
  let intento: Intento = { ok: false, status: null, transitorio: false, error: 'sin intentos' };
  for (let n = 1; n <= maxIntentos; n++) {
    intento = await intentarUnaVez(url, json, timeoutMs);
    if (intento.ok || !intento.transitorio || n === maxIntentos) return { ...intento, intentos: n };
    await esperar(BACKOFF_INMEDIATO_MS[Math.min(n - 1, BACKOFF_INMEDIATO_MS.length - 1)]);
  }
  return { ...intento, intentos: maxIntentos };
}
