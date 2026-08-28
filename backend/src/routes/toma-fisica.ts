import { Router } from 'express';
import {
  listarTomasFisicas,
  obtenerTomaFisica,
  crearTomaFisica,
  listarDetalleTomaFisica,
  registrarPesajeTomaFisica,
  eliminarPesajeTomaFisica,
  resumenTomaFisica,
  culminarTomaFisica,
} from '../services/toma-fisica-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { crearTomaFisicaSchema, registrarPesajeTomaFisicaSchema } from '../schemas/toma-fisica.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermiso('toma_fisica', 'ver'), async (_req, res) => {
  const tomasFisicas = await listarTomasFisicas();
  res.json({ tomasFisicas });
});

router.get('/:id', requirePermiso('toma_fisica', 'ver'), async (req, res) => {
  const id = String(req.params.id);
  const tomaFisica = await obtenerTomaFisica(id);
  if (!tomaFisica) {
    res.status(404).json({ error: 'Toma física no encontrada.' });
    return;
  }
  const detalle = await listarDetalleTomaFisica(id);
  res.json({ tomaFisica, detalle });
});

router.get('/:id/resumen', requirePermiso('toma_fisica', 'ver'), async (req, res) => {
  const lineas = await resumenTomaFisica(String(req.params.id));
  res.json({ lineas });
});

router.post('/', requirePermiso('toma_fisica', 'crear'), validateBody(crearTomaFisicaSchema), async (req, res) => {
  const result = await crearTomaFisica(req.body, req.user!.sub);
  if ('error' in result) {
    res.status(400).json(result);
    return;
  }
  logger.info({ evento: 'toma_fisica_creada', ip: clienteIp(req), userId: req.user!.sub, tomaFisicaId: result.tomaFisica.id });
  res.status(201).json(result);
});

router.post(
  '/:id/pesajes',
  requirePermiso('toma_fisica', 'crear'),
  validateBody(registrarPesajeTomaFisicaSchema),
  async (req, res) => {
    const result = await registrarPesajeTomaFisica(String(req.params.id), req.body, req.user!.sub);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    res.status(201).json(result);
  }
);

router.delete('/:id/pesajes/:detalleId', requirePermiso('toma_fisica', 'crear'), async (req, res) => {
  const result = await eliminarPesajeTomaFisica(String(req.params.detalleId));
  if ('error' in result) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

router.post('/:id/culminar', requirePermiso('toma_fisica', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const result = await culminarTomaFisica(id, req.user!.sub);
  if ('error' in result) {
    res.status(400).json(result);
    return;
  }
  logger.info({ evento: 'toma_fisica_culminada', ip: clienteIp(req), userId: req.user!.sub, tomaFisicaId: id });
  res.json(result);
});

export default router;
