import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { asistenteChatSchema, LIMITE_PETICIONES_POR_MINUTO } from '../utils/asistente-limites.js';
import { verificarAcceso } from '../services/asistente-acceso.js';
import { responderChat } from '../services/asistente-service.js';

const router = Router();

router.use(requireAuth);

/** Límite por usuario (no por IP: varias personas comparten la oficina). */
const asistenteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: LIMITE_PETICIONES_POR_MINUTO,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'BLOB necesita respirar. Espera un minuto y vuelve a preguntar.' },
  keyGenerator: req => req.user?.sub ?? ipKeyGenerator(req.ip ?? 'na'),
});

router.post('/chat', asistenteLimiter, validateBody(asistenteChatSchema), async (req, res) => {
  // En tests no se toca la base real: el acceso se prueba con dobles en asistente-acceso.test.ts.
  if (process.env.NODE_ENV !== 'test') {
    const acceso = await verificarAcceso(req.user!.sub);
    if (!acceso.ok) {
      res.status(acceso.status).json({ error: acceso.error });
      return;
    }
  }
  const resultado = await responderChat(req.body, { userId: req.user!.sub });
  res.json(resultado);
});

export default router;
