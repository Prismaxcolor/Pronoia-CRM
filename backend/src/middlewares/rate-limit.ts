import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

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
