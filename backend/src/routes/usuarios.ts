import { Router } from 'express';
import {
  listarUsuarios,
  crearUsuarioAdmin,
  actualizarUsuarioAdmin,
  desactivarUsuario,
  reactivarUsuario,
  borrarUsuario,
} from '../services/usuario-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { crearUsuarioSchema, actualizarUsuarioSchema } from '../schemas/usuarios.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermiso('usuarios', 'ver'), async (_req, res) => {
  const usuarios = await listarUsuarios();
  res.json({ usuarios });
});

router.post(
  '/',
  requirePermiso('usuarios', 'crear'),
  validateBody(crearUsuarioSchema),
  async (req, res) => {
    const result = await crearUsuarioAdmin(req.body);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'usuario_creado',
      ip: clienteIp(req),
      adminId: req.user!.sub,
      nuevoUserId: result.usuario.id,
      rol: result.usuario.rol,
    });
    res.status(201).json(result);
  }
);

router.patch(
  '/:id',
  requirePermiso('usuarios', 'editar'),
  validateBody(actualizarUsuarioSchema),
  async (req, res) => {
    const id = String(req.params.id);
    if (id === req.user!.sub && req.body.activo === false) {
      res.status(400).json({ error: 'No puedes desactivarte a ti mismo.' });
      return;
    }

    const result = await actualizarUsuarioAdmin(id, req.body);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'usuario_actualizado',
      ip: clienteIp(req),
      adminId: req.user!.sub,
      targetUserId: id,
      cambios: Object.keys(req.body),
    });
    res.json(result);
  }
);

router.post('/:id/desactivar', requirePermiso('usuarios', 'eliminar'), async (req, res) => {
  const id = String(req.params.id);
  if (id === req.user!.sub) {
    res.status(400).json({ error: 'No puedes desactivarte a ti mismo.' });
    return;
  }
  const ok = await desactivarUsuario(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo desactivar el usuario.' });
    return;
  }
  logger.info({
    evento: 'usuario_desactivado',
    ip: clienteIp(req),
    adminId: req.user!.sub,
    targetUserId: id,
  });
  res.json({ ok: true });
});

router.post('/:id/reactivar', requirePermiso('usuarios', 'eliminar'), async (req, res) => {
  const id = String(req.params.id);
  const ok = await reactivarUsuario(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo reactivar el usuario.' });
    return;
  }
  logger.info({
    evento: 'usuario_reactivado',
    ip: clienteIp(req),
    adminId: req.user!.sub,
    targetUserId: id,
  });
  res.json({ ok: true });
});

router.delete('/:id', requirePermiso('usuarios', 'eliminar'), async (req, res) => {
  const id = String(req.params.id);
  if (id === req.user!.sub) {
    res.status(400).json({ error: 'No puedes borrar tu propia cuenta.' });
    return;
  }

  const result = await borrarUsuario(id);
  if (!result.ok) {
    res.status(409).json({ error: result.razon, referencias: result.referencias });
    return;
  }

  logger.warn({
    evento: 'usuario_borrado',
    ip: clienteIp(req),
    adminId: req.user!.sub,
    targetUserId: id,
  });
  res.json({ ok: true });
});

export default router;
