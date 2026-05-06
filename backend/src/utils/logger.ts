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

/** Extrae IP del cliente respetando X-Forwarded-For (cuando hay proxy). */
export function clienteIp(req: { ip?: string; headers: Record<string, string | string[] | undefined> }): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0].trim();
  if (Array.isArray(fwd) && fwd.length > 0) return fwd[0];
  return req.ip ?? 'desconocida';
}

