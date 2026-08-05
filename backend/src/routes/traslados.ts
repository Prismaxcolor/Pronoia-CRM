import { Router } from 'express';
import { listarTraslados, obtenerTraslado, crearTraslado, completarTraslado } from '../services/traslado-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { crearTrasladoSchema, completarTrasladoSchema } from '../schemas/traslados.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

// Traslado = otra operación de pesaje (al lado de compra/venta) → mismo permiso 'pesaje'.

router.get('/', requirePermiso('pesaje', 'ver'), async (_req, res) => {
  const traslados = await listarTraslados();
  res.json({ traslados });
});

router.get('/:id', requirePermiso('pesaje', 'ver'), async (req, res) => {
  const traslado = await obtenerTraslado(String(req.params.id));
  if (!traslado) {
    res.status(404).json({ error: 'Traslado no encontrado.' });
    return;
  }
  res.json({ traslado });
});

router.post(
  '/',
  requirePermiso('pesaje', 'crear'),
  validateBody(crearTrasladoSchema),
  async (req, res) => {
    const result = await crearTraslado(req.body, req.user!.sub);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'traslado_creado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      trasladoId: result.traslado.id,
    });
    res.status(201).json(result);
  }
);

router.patch(
  '/:id/completar',
  requirePermiso('pesaje', 'crear'),
  validateBody(completarTrasladoSchema),
  async (req, res) => {
    const result = await completarTraslado(String(req.params.id), req.body, req.user!.sub);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'traslado_completado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      trasladoId: result.traslado.id,
    });
    res.json(result);
  }
);

export default router;
