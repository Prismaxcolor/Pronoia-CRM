import { Router } from 'express';
import {
  crearTransformacion,
  listarTransformaciones,
} from '../services/transformacion-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { crearTransformacionSchema } from '../schemas/transformaciones.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermiso('productos', 'ver'), async (req, res) => {
  const transformaciones = await listarTransformaciones({
    desde: req.query.desde ? String(req.query.desde) : undefined,
    hasta: req.query.hasta ? String(req.query.hasta) : undefined,
  });
  res.json({ transformaciones });
});

router.post(
  '/',
  requirePermiso('productos', 'crear'),
  validateBody(crearTransformacionSchema),
  async (req, res) => {
    const result = await crearTransformacion(req.body);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'transformacion_creada',
      ip: clienteIp(req),
      userId: req.user!.sub,
      transformacionId: result.id,
    });
    res.status(201).json(result);
  }
);

export default router;
