import { Router } from 'express';
import {
  listarProveedores,
  crearProveedor,
  actualizarProveedor,
  desactivarProveedor,
  reactivarProveedor,
  borrarProveedor,
} from '../services/proveedor-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { crearProveedorSchema, actualizarProveedorSchema } from '../schemas/proveedores.js';
import { obtenerEstadoCuenta } from '../services/estado-cuenta-service.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermiso('proveedores', 'ver'), async (_req, res) => {
  const proveedores = await listarProveedores();
  res.json({ proveedores });
});

router.get('/:id/estado-cuenta', requirePermiso('proveedores', 'ver'), async (req, res) => {
  const { desde, hasta } = req.query;
  const estado = await obtenerEstadoCuenta(
    'proveedor',
    String(req.params.id),
    desde ? String(desde) : undefined,
    hasta ? String(hasta) : undefined
  );
  if (!estado) {
    res.status(404).json({ error: 'Proveedor no encontrado.' });
    return;
  }
  res.json(estado);
});

router.post(
  '/',
  requirePermiso('proveedores', 'crear'),
  validateBody(crearProveedorSchema),
  async (req, res) => {
    const result = await crearProveedor(req.body);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'proveedor_creado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      proveedorId: result.proveedor.id,
    });
    res.status(201).json(result);
  }
);

router.patch(
  '/:id',
  requirePermiso('proveedores', 'editar'),
  validateBody(actualizarProveedorSchema),
  async (req, res) => {
    const id = String(req.params.id);
    const result = await actualizarProveedor(id, req.body);
    if ('error' in result) {
      const status = result.error.includes('no encontrado') ? 404 : 400;
      res.status(status).json(result);
      return;
    }
    logger.info({
      evento: 'proveedor_actualizado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      proveedorId: id,
    });
    res.json(result);
  }
);

router.post('/:id/desactivar', requirePermiso('proveedores', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const ok = await desactivarProveedor(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo desactivar el proveedor.' });
    return;
  }
  logger.info({
    evento: 'proveedor_desactivado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    proveedorId: id,
  });
  res.json({ ok: true });
});

router.post('/:id/reactivar', requirePermiso('proveedores', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const ok = await reactivarProveedor(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo reactivar el proveedor.' });
    return;
  }
  logger.info({
    evento: 'proveedor_reactivado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    proveedorId: id,
  });
  res.json({ ok: true });
});

router.delete('/:id', requirePermiso('proveedores', 'eliminar'), async (req, res) => {
  const id = String(req.params.id);
  const result = await borrarProveedor(id);
  if (!result.ok) {
    res.status(409).json({ error: result.razon });
    return;
  }
  logger.warn({
    evento: 'proveedor_borrado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    proveedorId: id,
  });
  res.json({ ok: true });
});

export default router;
