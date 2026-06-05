import { Router } from 'express';
import {
  listarTiposMaterial,
  crearTipoMaterial,
  actualizarTipoMaterial,
  desactivarTipoMaterial,
  reactivarTipoMaterial,
} from '../services/tipo-material-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import {
  crearTipoMaterialSchema,
  actualizarTipoMaterialSchema,
} from '../schemas/tipos-material.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

// Categorías de material = configuración del catálogo → permiso 'productos'.

router.get('/', requirePermiso('productos', 'ver'), async (_req, res) => {
  const tipos = await listarTiposMaterial();
  res.json({ tipos });
});

router.post(
  '/',
  requirePermiso('productos', 'crear'),
  validateBody(crearTipoMaterialSchema),
  async (req, res) => {
    const result = await crearTipoMaterial(req.body);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'tipo_material_creado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      tipoMaterialId: result.tipo.id,
    });
    res.status(201).json(result);
  }
);

router.patch(
  '/:id',
  requirePermiso('productos', 'editar'),
  validateBody(actualizarTipoMaterialSchema),
  async (req, res) => {
    const id = String(req.params.id);
    const result = await actualizarTipoMaterial(id, req.body);
    if ('error' in result) {
      const status = result.error.includes('no encontrada') ? 404 : 400;
      res.status(status).json(result);
      return;
    }
    logger.info({
      evento: 'tipo_material_actualizado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      tipoMaterialId: id,
    });
    res.json(result);
  }
);

router.post('/:id/desactivar', requirePermiso('productos', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const ok = await desactivarTipoMaterial(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo desactivar la categoría.' });
    return;
  }
  logger.info({
    evento: 'tipo_material_desactivado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    tipoMaterialId: id,
  });
  res.json({ ok: true });
});

router.post('/:id/reactivar', requirePermiso('productos', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const ok = await reactivarTipoMaterial(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo reactivar la categoría.' });
    return;
  }
  logger.info({
    evento: 'tipo_material_reactivado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    tipoMaterialId: id,
  });
  res.json({ ok: true });
});

export default router;
