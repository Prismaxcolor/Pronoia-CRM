import { Router } from 'express';
import {
  listarVehiculos,
  crearVehiculo,
  actualizarVehiculo,
  desactivarVehiculo,
  reactivarVehiculo,
} from '../services/vehiculo-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { crearVehiculoSchema, actualizarVehiculoSchema } from '../schemas/vehiculo.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

// Vehículos predefinidos = configuración de catálogo, globales → permiso 'vehiculos'.

router.get('/', requirePermiso('vehiculos', 'ver'), async (_req, res) => {
  const vehiculos = await listarVehiculos();
  res.json({ vehiculos });
});

router.post(
  '/',
  requirePermiso('vehiculos', 'crear'),
  validateBody(crearVehiculoSchema),
  async (req, res) => {
    const result = await crearVehiculo(req.body);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'vehiculo_creado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      vehiculoId: result.vehiculo.id,
    });
    res.status(201).json(result);
  }
);

router.patch(
  '/:id',
  requirePermiso('vehiculos', 'editar'),
  validateBody(actualizarVehiculoSchema),
  async (req, res) => {
    const id = String(req.params.id);
    const result = await actualizarVehiculo(id, req.body);
    if ('error' in result) {
      const status = result.error.includes('no encontrado') ? 404 : 400;
      res.status(status).json(result);
      return;
    }
    logger.info({
      evento: 'vehiculo_actualizado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      vehiculoId: id,
    });
    res.json(result);
  }
);

router.post('/:id/desactivar', requirePermiso('vehiculos', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const ok = await desactivarVehiculo(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo desactivar el vehículo.' });
    return;
  }
  logger.info({
    evento: 'vehiculo_desactivado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    vehiculoId: id,
  });
  res.json({ ok: true });
});

router.post('/:id/reactivar', requirePermiso('vehiculos', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const ok = await reactivarVehiculo(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo reactivar el vehículo.' });
    return;
  }
  logger.info({
    evento: 'vehiculo_reactivado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    vehiculoId: id,
  });
  res.json({ ok: true });
});

export default router;
