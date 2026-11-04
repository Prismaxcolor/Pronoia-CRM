import { Router } from 'express';
import {
  listarTaras,
  crearTara,
  actualizarTara,
  desactivarTara,
  reactivarTara,
} from '../services/tara-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { crearTaraSchema, actualizarTaraSchema } from '../schemas/tara.js';
import { logger, clienteIp } from '../utils/logger.js';
import { conOperacionCliente, cuerpoConRepetida, ejecutarOperacion, TIPO_OPERACION } from '../services/operaciones-idempotentes-cola.js';

const router = Router();

router.use(requireAuth);

// Taras predefinidas = configuración de catálogo, globales → permiso 'taras'.

router.get('/', requirePermiso('taras', 'ver'), async (_req, res) => {
  const taras = await listarTaras();
  res.json({ taras });
});

router.post(
  '/',
  requirePermiso('taras', 'crear'),
  validateBody(conOperacionCliente(crearTaraSchema)),
  async (req, res) => {
    const envio = await ejecutarOperacion(res, TIPO_OPERACION.taraCrear, req.body, req.user!.sub, () => crearTara(req.body));
    if (!envio) return;
    const { resultado: result, repetida } = envio;
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'tara_creada',
      ip: clienteIp(req),
      userId: req.user!.sub,
      taraId: result.tara.id,
    });
    res.status(repetida ? 200 : 201).json(cuerpoConRepetida(result, repetida));
  }
);

router.patch(
  '/:id',
  requirePermiso('taras', 'editar'),
  validateBody(actualizarTaraSchema),
  async (req, res) => {
    const id = String(req.params.id);
    const result = await actualizarTara(id, req.body);
    if ('error' in result) {
      const status = result.error.includes('no encontrada') ? 404 : 400;
      res.status(status).json(result);
      return;
    }
    logger.info({
      evento: 'tara_actualizada',
      ip: clienteIp(req),
      userId: req.user!.sub,
      taraId: id,
    });
    res.json(result);
  }
);

router.post('/:id/desactivar', requirePermiso('taras', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const ok = await desactivarTara(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo desactivar la tara.' });
    return;
  }
  logger.info({
    evento: 'tara_desactivada',
    ip: clienteIp(req),
    userId: req.user!.sub,
    taraId: id,
  });
  res.json({ ok: true });
});

router.post('/:id/reactivar', requirePermiso('taras', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const ok = await reactivarTara(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo reactivar la tara.' });
    return;
  }
  logger.info({
    evento: 'tara_reactivada',
    ip: clienteIp(req),
    userId: req.user!.sub,
    taraId: id,
  });
  res.json({ ok: true });
});

export default router;
