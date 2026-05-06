import { Router } from 'express';
import { login, registro, obtenerUsuarioPorId } from '../services/auth-service.js';
import { requireAuth } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { loginLimiter, registerLimiter } from '../middlewares/rate-limit.js';
import { loginSchema, registerSchema } from '../schemas/auth.js';
import { logger, clienteIp } from '../utils/logger.js';

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

export default router;
