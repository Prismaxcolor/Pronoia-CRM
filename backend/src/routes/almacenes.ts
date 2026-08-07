import { Router } from 'express';
import {
  listarAlmacenes,
  crearAlmacen,
  actualizarAlmacen,
  desactivarAlmacen,
  reactivarAlmacen,
  stockAlmacen,
  marcarPredeterminado,
} from '../services/almacen-service.js';
import { obtenerInventarioAlmacen } from '../services/inventario-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { crearAlmacenSchema, actualizarAlmacenSchema } from '../schemas/almacen.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

// Almacenes tiene su propio permiso (antes reusaba 'productos').

router.get('/', requirePermiso('almacenes', 'ver'), async (_req, res) => {
  const almacenes = await listarAlmacenes();
  res.json({ almacenes });
});

router.get('/:id/stock', requirePermiso('almacenes', 'ver'), async (req, res) => {
  const stock = await stockAlmacen(String(req.params.id));
  res.json({ stock: Object.fromEntries(stock) });
});

router.get('/:id/inventario', requirePermiso('almacenes', 'ver'), async (req, res) => {
  const grupos = await obtenerInventarioAlmacen(String(req.params.id));
  res.json({ grupos });
});

router.post(
  '/',
  requirePermiso('almacenes', 'crear'),
  validateBody(crearAlmacenSchema),
  async (req, res) => {
    const result = await crearAlmacen(req.body);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'almacen_creado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      almacenId: result.almacen.id,
    });
    res.status(201).json(result);
  }
);

router.patch(
  '/:id',
  requirePermiso('almacenes', 'editar'),
  validateBody(actualizarAlmacenSchema),
  async (req, res) => {
    const id = String(req.params.id);
    const result = await actualizarAlmacen(id, req.body);
    if ('error' in result) {
      const status = result.error.includes('no encontrado') ? 404 : 400;
      res.status(status).json(result);
      return;
    }
    logger.info({
      evento: 'almacen_actualizado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      almacenId: id,
    });
    res.json(result);
  }
);

router.post('/:id/desactivar', requirePermiso('almacenes', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const result = await desactivarAlmacen(id);
  if ('error' in result) {
    res.status(400).json(result);
    return;
  }
  logger.info({
    evento: 'almacen_desactivado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    almacenId: id,
  });
  res.json({ ok: true });
});

router.post('/:id/marcar-predeterminado', requirePermiso('almacenes', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const result = await marcarPredeterminado(id);
  if ('error' in result) {
    res.status(400).json(result);
    return;
  }
  logger.info({
    evento: 'almacen_predeterminado_cambiado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    almacenId: id,
  });
  res.json(result);
});

router.post('/:id/reactivar', requirePermiso('almacenes', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const ok = await reactivarAlmacen(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo reactivar el almacén.' });
    return;
  }
  logger.info({
    evento: 'almacen_reactivado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    almacenId: id,
  });
  res.json({ ok: true });
});

export default router;
