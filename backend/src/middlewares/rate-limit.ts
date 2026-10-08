import type { Request } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { verificarToken } from '../services/auth-service.js';

/**
 * 5 intentos de login por IP por minuto. Usa la combinación IP + email del body
 * para que un atacante no pueda cubrir múltiples cuentas por debajo del límite.
 */
export const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de login. Espera un minuto y reintenta.' },
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
    return `${ipKeyGenerator(req.ip ?? 'na')}::${email}`;
  },
});

/** 3 registros por IP por hora. Frena bots que crean cuentas en masa. */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados registros desde esta IP. Reintenta más tarde.' },
});

/** 5 solicitudes de link de acceso al portal por IP+identificador por minuto. */
export const portalLoginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera un minuto y reintenta.' },
  keyGenerator: (req) => {
    const identificador = typeof req.body?.identificador === 'string' ? req.body.identificador : '';
    return `${ipKeyGenerator(req.ip ?? 'na')}::${identificador}`;
  },
});

/** 1 envío de estado de cuenta por Telegram por minuto por usuario+entidad (evita spamear al proveedor/cliente). */
export const estadoCuentaTelegramLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 1,
  skipFailedRequests: true, // un 404/409 (sin vincular, etc.) no gasta el cupo
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Ya se envió el estado de cuenta hace instantes. Espera un minuto antes de reenviarlo.' },
  keyGenerator: (req) => `${req.user?.sub ?? ipKeyGenerator(req.ip ?? 'na')}::${String(req.params.id)}`,
});

/** Operaciones con clientRequestId por usuario y minuto (modo sin conexión). */
export const LIMITE_OPERACIONES_CLIENTE_POR_MINUTO = 120;

const METODOS_SIN_ESCRITURA = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Identifica al usuario por su JWT (el limitador corre antes de requireAuth de cada router); sin token válido, por IP. */
export function claveOperacionCliente(req: Request): string {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      return `u:${verificarToken(header.slice('Bearer '.length).trim()).sub}`;
    } catch {
      // token inválido: lo rechazará requireAuth; mientras tanto cuenta contra la IP
    }
  }
  return `ip:${ipKeyGenerator(req.ip ?? 'na')}`;
}

/** Solo cuenta las peticiones de escritura que traen clientRequestId: son las que escriben en operaciones_cliente. */
export function esOperacionConClientRequestId(req: Request): boolean {
  if (METODOS_SIN_ESCRITURA.has(req.method)) return false;
  const body = req.body as { clientRequestId?: unknown } | undefined;
  return typeof body?.clientRequestId === 'string';
}

/** Frena la generación masiva de filas en operaciones_cliente con UUID aleatorios: 120/min por usuario. */
export const operacionesClienteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: LIMITE_OPERACIONES_CLIENTE_POR_MINUTO,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => !esOperacionConClientRequestId(req),
  message: { error: 'Demasiadas operaciones en poco tiempo. Reintenta en un minuto.', reintentar: true },
  keyGenerator: claveOperacionCliente,
});
