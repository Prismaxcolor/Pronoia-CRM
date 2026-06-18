import { Router } from 'express';
import { listarLotes, crearLote, actualizarLote } from '../services/lote-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { crearLoteSchema, actualizarLoteSchema } from '../schemas/lotes.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

// Los lotes son configuración de almacén → permiso 'productos'.

router.get('/', requirePermiso('productos', 'ver'), async (_req, res) => {
  const lotes = await listarLotes();
  res.json({ lotes });
});

router.post(
  '/',
  requirePermiso('productos', 'crear'),
  validateBody(crearLoteSchema),
  async (req, res) => {
    const result = await crearLote(req.body);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({ evento: 'lote_creado', ip: clienteIp(req), userId: req.user!.sub, loteId: result.lote.id });
    res.status(201).json(result);
  }
);

router.patch(
  '/:id',
  requirePermiso('productos', 'editar'),
  validateBody(actualizarLoteSchema),
  async (req, res) => {
    const id = String(req.params.id);
    const result = await actualizarLote(id, req.body);
    if ('error' in result) {
      const status = result.error.includes('no encontrado') ? 404 : 400;
      res.status(status).json(result);
      return;
    }
    logger.info({ evento: 'lote_actualizado', ip: clienteIp(req), userId: req.user!.sub, loteId: id });
    res.json(result);
  }
);

export default router;
