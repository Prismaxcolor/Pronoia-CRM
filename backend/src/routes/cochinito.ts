import { Router } from 'express';
import {
  listarBancas,
  listarMovimientos,
  crearBanca,
  actualizarBanca,
  archivarBanca,
  desarchivarBanca,
  crearMovimiento,
} from '../services/banca-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { crearBancaSchema, actualizarBancaSchema, crearMovimientoSchema } from '../schemas/cochinito.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

router.get('/bancas', requirePermiso('cochinito', 'ver'), async (req, res) => {
  const incluirArchivadas = req.query.incluirArchivadas === 'true';
  const bancas = await listarBancas({ incluirArchivadas });
  res.json({ bancas });
});

router.post(
  '/bancas',
  requirePermiso('cochinito', 'crear'),
  validateBody(crearBancaSchema),
  async (req, res) => {
    const result = await crearBanca(req.body);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'banca_creada',
      ip: clienteIp(req),
      userId: req.user!.sub,
      bancaId: result.banca.id,
    });
    res.status(201).json(result);
  }
);

router.patch(
  '/bancas/:id',
  requirePermiso('cochinito', 'editar'),
  validateBody(actualizarBancaSchema),
  async (req, res) => {
    const id = String(req.params.id);
    const result = await actualizarBanca(id, req.body);
    if ('error' in result) {
      const status = result.error.includes('no encontrada') ? 404 : 400;
      res.status(status).json(result);
      return;
    }
    logger.info({
      evento: 'banca_actualizada',
      ip: clienteIp(req),
      userId: req.user!.sub,
      bancaId: id,
    });
    res.json(result);
  }
);

router.post('/bancas/:id/archivar', requirePermiso('cochinito', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const result = await archivarBanca(id);
  if (!result.ok) {
    res.status(409).json({ error: result.razon });
    return;
  }
  logger.info({
    evento: 'banca_archivada',
    ip: clienteIp(req),
    userId: req.user!.sub,
    bancaId: id,
  });
  res.json({ ok: true });
});

router.post('/bancas/:id/desarchivar', requirePermiso('cochinito', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const ok = await desarchivarBanca(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo desarchivar la banca.' });
    return;
  }
  logger.info({
    evento: 'banca_desarchivada',
    ip: clienteIp(req),
    userId: req.user!.sub,
    bancaId: id,
  });
  res.json({ ok: true });
});

router.get('/movimientos', requirePermiso('cochinito', 'ver'), async (_req, res) => {
  const movimientos = await listarMovimientos();
  res.json({ movimientos });
});

router.post(
  '/movimientos',
  requirePermiso('cochinito', 'crear'),
  validateBody(crearMovimientoSchema),
  async (req, res) => {
    const result = await crearMovimiento(req.body, req.user!.sub);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'movimiento_creado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      movimientoId: result.movimiento.id,
      tipo: result.movimiento.tipo,
    });
    res.status(201).json(result);
  }
);

export default router;
