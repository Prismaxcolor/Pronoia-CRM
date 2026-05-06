import { Router } from 'express';
import {
  listarClientes,
  crearCliente,
  actualizarCliente,
  desactivarCliente,
  reactivarCliente,
  borrarCliente,
} from '../services/cliente-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { crearClienteSchema, actualizarClienteSchema } from '../schemas/clientes.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermiso('clientes', 'ver'), async (_req, res) => {
  const clientes = await listarClientes();
  res.json({ clientes });
});

router.post(
  '/',
  requirePermiso('clientes', 'crear'),
  validateBody(crearClienteSchema),
  async (req, res) => {
    const result = await crearCliente(req.body, req.user!.sub);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'cliente_creado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      clienteId: result.cliente.id,
    });
    res.status(201).json(result);
  }
);

router.patch(
  '/:id',
  requirePermiso('clientes', 'editar'),
  validateBody(actualizarClienteSchema),
  async (req, res) => {
    const id = String(req.params.id);
    const result = await actualizarCliente(id, req.body);
    if ('error' in result) {
      const status = result.error.includes('no encontrado') ? 404 : 400;
      res.status(status).json(result);
      return;
    }
    logger.info({
      evento: 'cliente_actualizado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      clienteId: id,
    });
    res.json(result);
  }
);

router.post('/:id/desactivar', requirePermiso('clientes', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const ok = await desactivarCliente(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo desactivar el cliente.' });
    return;
  }
  logger.info({
    evento: 'cliente_desactivado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    clienteId: id,
  });
  res.json({ ok: true });
});

router.post('/:id/reactivar', requirePermiso('clientes', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const ok = await reactivarCliente(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo reactivar el cliente.' });
    return;
  }
  logger.info({
    evento: 'cliente_reactivado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    clienteId: id,
  });
  res.json({ ok: true });
});

router.delete('/:id', requirePermiso('clientes', 'eliminar'), async (req, res) => {
  const id = String(req.params.id);
  const result = await borrarCliente(id);
  if (!result.ok) {
    res.status(409).json({ error: result.razon });
    return;
  }
  logger.warn({
    evento: 'cliente_borrado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    clienteId: id,
  });
  res.json({ ok: true });
});

export default router;
