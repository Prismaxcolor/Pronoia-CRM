import { logger } from '../utils/logger.js';
import { encolarAviso } from './avisos-pendientes-service.js';
import { enviarN8n, urlDeDestino, type DestinoN8n, type OpcionesEnvioN8n, type ResultadoN8n } from './n8n-cliente.js';

export interface EnvioAviso {
  destino: DestinoN8n;
  /** Cuerpo JSON. Sin secretos: si el envío se encola, se guarda tal cual en la BD. */
  cuerpo: Record<string, unknown>;
  /** Prefijo de los eventos de log (p. ej. 'telegram_notify' → telegram_notify_error_webhook_status). */
  evento: string;
  /** Datos extra para el log (acción, clave del evento...). */
  contexto?: Record<string, unknown>;
  /** false: no se guarda en la cola aunque falle (p. ej. si el cuerpo lleva un token de un solo uso). */
  encolar?: boolean;
  opciones?: OpcionesEnvioN8n;
}

function registrarFallo(envio: EnvioAviso, resultado: ResultadoN8n): void {
  const base = { ...envio.contexto, intentos: resultado.intentos };
  if (resultado.status !== null) {
    logger.error({ evento: `${envio.evento}_error_webhook_status`, status: resultado.status, ...base });
    return;
  }
  logger.error({ evento: `${envio.evento}_error_webhook`, mensaje: resultado.error, ...base });
}

/**
 * Envía un aviso a n8n con reintentos inmediatos; si siguen fallando por causas transitorias lo deja
 * en la cola (avisos_pendientes) para el cron. Nunca lanza: el negocio no debe fallar por un aviso.
 */
export async function enviarAvisoN8n(envio: EnvioAviso): Promise<ResultadoN8n> {
  const url = urlDeDestino(envio.destino);
  const fallo: ResultadoN8n = { ok: false, status: null, intentos: 0, transitorio: false, error: 'webhook no configurado' };
  if (!url) return fallo;
  try {
    const resultado = await enviarN8n(url, envio.cuerpo, envio.opciones);
    if (resultado.ok) return resultado;
    registrarFallo(envio, resultado);
    if (resultado.transitorio && envio.encolar !== false) {
      await encolarAviso(envio.destino, envio.cuerpo, resultado.error ?? 'error desconocido', resultado.intentos);
    }
    return resultado;
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    logger.error({ evento: `${envio.evento}_error_webhook`, mensaje, ...envio.contexto });
    return { ...fallo, error: mensaje };
  }
}
