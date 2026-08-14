import { Router } from 'express';
import {
  listarTransformaciones,
  obtenerTransformacion,
  crearTransformacion,
  completarTransformacion,
  borrarTransformacion,
} from '../services/transformacion-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { crearTransformacionSchema, completarTransformacionSchema } from '../schemas/transformaciones.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermiso('transformaciones', 'ver'), async (req, res) => {
  const desde = req.query.desde ? String(req.query.desde) : undefined;
  const hasta = req.query.hasta ? String(req.query.hasta) : undefined;
  const estado = req.query.estado === 'bruto' || req.query.estado === 'completa' ? req.query.estado : undefined;
  const transformaciones = await listarTransformaciones({ desde, hasta, estado });
  res.json({ transformaciones });
});

router.get('/:id', requirePermiso('transformaciones', 'ver'), async (req, res) => {
  const transformacion = await obtenerTransformacion(String(req.params.id));
  if (!transformacion) {
    res.status(404).json({ error: 'Transformación no encontrada.' });
    return;
  }
  res.json({ transformacion });
});

router.post(
  '/',
  requirePermiso('transformaciones', 'crear'),
  validateBody(crearTransformacionSchema),
  async (req, res) => {
    const result = await crearTransformacion(req.body, req.user!.sub);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'transformacion_creada',
      ip: clienteIp(req),
      userId: req.user!.sub,
      transformacionId: result.transformacion.id,
    });
    res.status(201).json(result);
  }
);

router.patch(
  '/:id/completar',
  requirePermiso('transformaciones', 'crear'),
  validateBody(completarTransformacionSchema),
  async (req, res) => {
    const result = await completarTransformacion(String(req.params.id), req.body, req.user!.sub);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'transformacion_completada',
      ip: clienteIp(req),
      userId: req.user!.sub,
      transformacionId: result.transformacion.id,
    });
    res.json(result);
  }
);

router.delete('/:id', requirePermiso('transformaciones', 'eliminar'), async (req, res) => {
  const id = String(req.params.id);
  const result = await borrarTransformacion(id);
  if (!result.ok) {
    res.status(result.noEncontrado ? 404 : 409).json({ error: result.razon });
    return;
  }
  logger.info({
    evento: 'transformacion_eliminada',
    ip: clienteIp(req),
    userId: req.user!.sub,
    transformacionId: id,
  });
  res.json({ ok: true });
});

export default router;
