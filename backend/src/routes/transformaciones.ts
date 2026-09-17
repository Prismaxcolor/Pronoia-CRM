import { Router } from 'express';
import {
  listarTransformaciones,
  obtenerTransformacion,
  crearTransformacion,
  completarTransformacion,
  borrarTransformacion,
  crearTransformacionFerroso,
  completarTransformacionFerroso,
  obtenerSalidasComunes,
  guardarSalidasComunesProducto,
  crearTransformacionPCB,
  completarTransformacionPCB,
} from '../services/transformacion-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import {
  crearTransformacionSchema,
  completarTransformacionSchema,
  crearTransformacionFerrosoSchema,
  completarTransformacionFerrosoSchema,
  guardarSalidasComunesSchema,
  crearTransformacionPCBSchema,
  completarTransformacionPCBSchema,
} from '../schemas/transformaciones.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

router.get('/', requirePermiso('transformaciones', 'ver'), async (req, res) => {
  const desde = req.query.desde ? String(req.query.desde) : undefined;
  const hasta = req.query.hasta ? String(req.query.hasta) : undefined;
  const estado = req.query.estado === 'bruto' || req.query.estado === 'completa' ? req.query.estado : undefined;
  const categoria = req.query.categoria ? String(req.query.categoria) : undefined;
  const transformaciones = await listarTransformaciones({ desde, hasta, estado, categoria });
  res.json({ transformaciones });
});

// ---------------------------------------------------------------------------
// Configuración: salidas comunes (antes de /:id para evitar shadowing)
// ---------------------------------------------------------------------------

router.get('/config/salidas-comunes', requirePermiso('transformaciones', 'ver'), async (req, res) => {
  const productoEntradaId = req.query.productoEntradaId ? String(req.query.productoEntradaId) : undefined;
  const salidas = await obtenerSalidasComunes(productoEntradaId);
  res.json({ salidas });
});

router.put(
  '/config/salidas-comunes/:productoId',
  requirePermiso('transformaciones', 'crear'),
  validateBody(guardarSalidasComunesSchema),
  async (req, res) => {
    const result = await guardarSalidasComunesProducto(
      String(req.params.productoId),
      req.body.productosSalidaIds
    );
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  }
);

router.get('/:id', requirePermiso('transformaciones', 'ver'), async (req, res) => {
  const transformacion = await obtenerTransformacion(String(req.params.id));
  if (!transformacion) {
    res.status(404).json({ error: 'Transformación no encontrada.' });
    return;
  }
  res.json({ transformacion });
});

// ---------------------------------------------------------------------------
// Legacy (lote-pool)
// ---------------------------------------------------------------------------

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
    logger.info({ evento: 'transformacion_creada', ip: clienteIp(req), userId: req.user!.sub, transformacionId: result.transformacion.id });
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
    logger.info({ evento: 'transformacion_completada', ip: clienteIp(req), userId: req.user!.sub, transformacionId: result.transformacion.id });
    res.json(result);
  }
);

// ---------------------------------------------------------------------------
// Ferroso / No Ferroso
// ---------------------------------------------------------------------------

router.post(
  '/ferroso',
  requirePermiso('transformaciones', 'crear'),
  validateBody(crearTransformacionFerrosoSchema),
  async (req, res) => {
    const result = await crearTransformacionFerroso(req.body, req.user!.sub);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({ evento: 'transformacion_ferroso_creada', ip: clienteIp(req), userId: req.user!.sub, transformacionId: result.transformacion.id });
    res.status(201).json(result);
  }
);

router.patch(
  '/:id/completar-ferroso',
  requirePermiso('transformaciones', 'crear'),
  validateBody(completarTransformacionFerrosoSchema),
  async (req, res) => {
    const result = await completarTransformacionFerroso(String(req.params.id), req.body, req.user!.sub);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({ evento: 'transformacion_ferroso_completada', ip: clienteIp(req), userId: req.user!.sub, transformacionId: result.transformacion.id });
    res.json(result);
  }
);

// ---------------------------------------------------------------------------
// PCB
// ---------------------------------------------------------------------------

router.post(
  '/pcb',
  requirePermiso('transformaciones', 'crear'),
  validateBody(crearTransformacionPCBSchema),
  async (req, res) => {
    const result = await crearTransformacionPCB(req.body, req.user!.sub);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({ evento: 'transformacion_pcb_creada', ip: clienteIp(req), userId: req.user!.sub, transformacionId: result.transformacion.id });
    res.status(201).json(result);
  }
);

router.patch(
  '/:id/completar-pcb',
  requirePermiso('transformaciones', 'crear'),
  validateBody(completarTransformacionPCBSchema),
  async (req, res) => {
    const result = await completarTransformacionPCB(String(req.params.id), req.body, req.user!.sub);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({ evento: 'transformacion_pcb_completada', ip: clienteIp(req), userId: req.user!.sub, transformacionId: result.transformacion.id });
    res.json(result);
  }
);

// ---------------------------------------------------------------------------
// Eliminar
// ---------------------------------------------------------------------------

router.delete('/:id', requirePermiso('transformaciones', 'eliminar'), async (req, res) => {
  const id = String(req.params.id);
  const result = await borrarTransformacion(id);
  if (!result.ok) {
    res.status(result.noEncontrado ? 404 : 409).json({ error: result.razon });
    return;
  }
  logger.info({ evento: 'transformacion_eliminada', ip: clienteIp(req), userId: req.user!.sub, transformacionId: id });
  res.json({ ok: true });
});

export default router;
