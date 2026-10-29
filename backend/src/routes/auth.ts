import { Router } from 'express';
import { login, registro, obtenerUsuarioPorId } from '../services/auth-service.js';
import { requireAuth } from '../middlewares/require-auth.js';
import { validateBody, validateParams } from '../middlewares/validate.js';
import { loginLimiter, registerLimiter, passkeyLoginLimiter, passkeyReauthLimiter } from '../middlewares/rate-limit.js';
import {
  loginSchema,
  registerSchema,
  passkeyRegistroVerifySchema,
  passkeyLoginVerifySchema,
  passkeyIdParamsSchema,
  passkeyPasswordSchema,
} from '../schemas/auth.js';
import {
  opcionesRegistro,
  verificarRegistro,
  listarPasskeys,
  borrarPasskey,
  opcionesLogin,
  verificarLogin,
} from '../services/passkey-service.js';
import { logger, clienteIp } from '../utils/logger.js';
import { obtenerOfflineConfig } from '../services/offline-config-service.js';

const router = Router();

router.post('/login', loginLimiter, validateBody(loginSchema), async (req, res) => {
  const { email, password } = req.body;

  const result = await login(email, password);
  if (!result) {
    logger.warn({
      evento: 'login_fallido',
      ip: clienteIp(req),
      email,
      userAgent: req.headers['user-agent'],
    });
    res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    return;
  }

  logger.info({ evento: 'login_exitoso', ip: clienteIp(req), userId: result.usuario.id });
  res.json(result);
});

router.post('/register', registerLimiter, validateBody(registerSchema), async (req, res) => {
  const { email, password, nombre } = req.body;

  const result = await registro({ email, password, nombre });
  if ('error' in result) {
    logger.warn({
      evento: 'registro_rechazado',
      ip: clienteIp(req),
      email,
      razon: result.error,
    });
    res.status(400).json(result);
    return;
  }

  logger.info({ evento: 'registro_exitoso', ip: clienteIp(req), userId: result.usuario.id });
  res.status(201).json(result);
});

router.get('/me', requireAuth, async (req, res) => {
  const usuario = await obtenerUsuarioPorId(req.user!.sub);
  if (!usuario) {
    res.status(404).json({ error: 'Usuario no encontrado o inactivo.' });
    return;
  }
  res.json({ usuario });
});

/** Interruptor del modo sin conexión (configuracion_secreta.OFFLINE_ACTIVO). Ligero: el cliente lo
 *  consulta junto con /me y recuerda el último valor para usarlo sin red. */
router.get('/offline-config', requireAuth, async (req, res) => {
  res.json(await obtenerOfflineConfig(req.user!.sub));
});

// --- Passkeys (WebAuthn) ---------------------------------------------------------------

const ERROR_PASSKEY_REGISTRO = 'No se pudo registrar la passkey.';
const ERROR_PASSKEY_LOGIN = 'No se pudo iniciar sesión con la passkey.';

const ERROR_PASSWORD = 'Contraseña incorrecta';

router.post(
  '/passkey/register/options',
  requireAuth,
  passkeyReauthLimiter,
  validateBody(passkeyPasswordSchema),
  async (req, res) => {
  const result = await opcionesRegistro(req.user!.sub, req.headers.origin, req.body.password);
  if ('error' in result) {
    // 403 (no 401): el frontend cierra sesion ante un 401.
    if (result.error === 'password') {
      res.status(403).json({ error: ERROR_PASSWORD });
      return;
    }
    const limite = result.error === 'limite';
    res.status(400).json({
      error: limite ? 'Alcanzaste el máximo de passkeys. Elimina alguna para agregar otra.' : ERROR_PASSKEY_REGISTRO,
    });
    return;
  }
  res.json(result.opciones);
  },
);

router.post(
  '/passkey/register/verify',
  requireAuth,
  validateBody(passkeyRegistroVerifySchema),
  async (req, res) => {
    const { respuesta, nombre } = req.body;
    const result = await verificarRegistro(req.user!.sub, req.headers.origin, respuesta, nombre);
    if ('error' in result) {
      res.status(400).json({ error: ERROR_PASSKEY_REGISTRO });
      return;
    }
    res.status(201).json({ passkey: result.passkey });
  },
);

router.get('/passkeys', requireAuth, async (req, res) => {
  res.json({ passkeys: await listarPasskeys(req.user!.sub) });
});

router.delete(
  '/passkeys/:id',
  requireAuth,
  passkeyReauthLimiter,
  validateParams(passkeyIdParamsSchema),
  validateBody(passkeyPasswordSchema),
  async (req, res) => {
  const ok = await borrarPasskey(req.user!.sub, req.params.id as string, req.body.password);
  if (ok === 'password') {
    res.status(403).json({ error: ERROR_PASSWORD });
    return;
  }
  if (!ok) {
    res.status(404).json({ error: 'Passkey no encontrada.' });
    return;
  }
  res.json({ ok: true });
  },
);

router.post('/passkey/login/options', passkeyLoginLimiter, async (req, res) => {
  const result = await opcionesLogin(req.headers.origin);
  if ('error' in result) {
    if (result.error === 'saturado') {
      res.status(429).json({ error: ERROR_PASSKEY_LOGIN });
      return;
    }
    res.status(400).json({ error: ERROR_PASSKEY_LOGIN });
    return;
  }
  res.json({ ...result.opciones, loginId: result.loginId });
});

router.post(
  '/passkey/login/verify',
  passkeyLoginLimiter,
  validateBody(passkeyLoginVerifySchema),
  async (req, res) => {
    const { loginId, respuesta } = req.body;
    const result = await verificarLogin(req.headers.origin, loginId, respuesta);
    if (!result) {
      logger.warn({ evento: 'login_passkey_fallido', ip: clienteIp(req), userAgent: req.headers['user-agent'] });
      res.status(401).json({ error: ERROR_PASSKEY_LOGIN });
      return;
    }
    logger.info({ evento: 'login_exitoso', metodo: 'passkey', ip: clienteIp(req), userId: result.usuario.id });
    res.json(result);
  },
);

export default router;
