type Nivel = 'info' | 'warn' | 'error';

interface LogPayload {
  evento: string;
  [k: string]: unknown;
}

function formatear(nivel: Nivel, payload: LogPayload): string {
  const linea = {
    timestamp: new Date().toISOString(),
    nivel,
    ...payload,
  };
  return JSON.stringify(linea);
}

/**
 * Logger estructurado mínimo. Saca JSON por línea para que sea
 * parseable por agregadores (Loki, Datadog) cuando llegue el momento.
 */
export const logger = {
  info(payload: LogPayload) {
    console.log(formatear('info', payload));
  },
  warn(payload: LogPayload) {
    console.warn(formatear('warn', payload));
  },
  error(payload: LogPayload) {
    console.error(formatear('error', payload));
  },
};

/** IP del cliente segun Express (req.ip, que ya respeta 'trust proxy'). No se lee X-Forwarded-For
 *  a mano: el primer valor lo controla el cliente y permitiria falsear la IP en los logs. */
export function clienteIp(req: { ip?: string; headers?: Record<string, string | string[] | undefined> }): string {
  return req.ip ?? 'desconocida';
}

