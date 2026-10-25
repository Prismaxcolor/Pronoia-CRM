import { Router } from 'express';
import {
  listarVehiculos,
  crearVehiculo,
  actualizarVehiculo,
  desactivarVehiculo,
  reactivarVehiculo,
  eliminarVehiculo,
} from '../services/vehiculo-service.js';
import { requireAuth, requirePermiso, requireAlgunPermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { crearVehiculoSchema, actualizarVehiculoSchema } from '../schemas/vehiculo.js';
import { logger, clienteIp } from '../utils/logger.js';
import { conOperacionCliente, cuerpoConRepetida, ejecutarOperacion, TIPO_OPERACION } from '../services/operaciones-idempotentes-cola.js';

const router = Router();

router.use(requireAuth);

// Vehículos predefinidos = configuración de catálogo, globales → permiso 'vehiculos'.

// Listar también lo puede quien pesa (pesaje:ver): el selector de vehículos del pesaje lo necesita
// y los permisos personalizados reemplazan a los del rol, así que 'vehiculos' puede faltar.
router.get('/', requireAlgunPermiso(
  { recurso: 'vehiculos', accion: 'ver' },
  { recurso: 'pesaje', accion: 'ver' },
), async (_req, res) => {
  const vehiculos = await listarVehiculos();
  res.json({ vehiculos });
});

router.post(
  '/',
  requirePermiso('vehiculos', 'crear'),
  validateBody(conOperacionCliente(crearVehiculoSchema)),
  async (req, res) => {
    const envio = await ejecutarOperacion(res, TIPO_OPERACION.vehiculoCrear, req.body, req.user!.sub, () => crearVehiculo(req.body));
    if (!envio) return;
    const { resultado: result, repetida } = envio;
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
    res.status(repetida ? 200 : 201).json(cuerpoConRepetida(result, repetida));
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
  const result = await reactivarVehiculo(id);
  if ('error' in result) {
    res.status(400).json(result);
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

router.delete('/:id', requirePermiso('vehiculos', 'eliminar'), async (req, res) => {
  const id = String(req.params.id);
  const ok = await eliminarVehiculo(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo eliminar el vehículo.' });
    return;
  }
  logger.info({
    evento: 'vehiculo_eliminado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    vehiculoId: id,
  });
  res.json({ ok: true });
});

export default router;
