import { Router } from 'express';
import {
  listarAlmacenes,
  crearAlmacen,
  actualizarAlmacen,
  desactivarAlmacen,
  reactivarAlmacen,
  stockAlmacen,
} from '../services/almacen-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { crearAlmacenSchema, actualizarAlmacenSchema } from '../schemas/almacen.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

// Almacenes = catálogo de inventario, mismo permiso que taras/productos.

router.get('/', requirePermiso('productos', 'ver'), async (_req, res) => {
  const almacenes = await listarAlmacenes();
  res.json({ almacenes });
});

router.get('/:id/stock', requirePermiso('productos', 'ver'), async (req, res) => {
  const stock = await stockAlmacen(String(req.params.id));
  res.json({ stock: Object.fromEntries(stock) });
});

router.post(
  '/',
  requirePermiso('productos', 'crear'),
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
  requirePermiso('productos', 'editar'),
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

router.post('/:id/desactivar', requirePermiso('productos', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const ok = await desactivarAlmacen(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo desactivar el almacén.' });
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

router.post('/:id/reactivar', requirePermiso('productos', 'editar'), async (req, res) => {
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
