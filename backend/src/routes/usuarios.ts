import { Router } from 'express';
import {
  listarUsuarios,
  crearUsuarioAdmin,
  actualizarUsuarioAdmin,
  desactivarUsuario,
  reactivarUsuario,
  borrarUsuario,
} from '../services/usuario-service.js';
import {
  generarLinkTelegramUsuario,
  desvincularTelegramUsuario,
  puedeGestionarTelegramDe,
} from '../services/usuario-telegram-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { crearUsuarioSchema, actualizarUsuarioSchema } from '../schemas/usuarios.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermiso('usuarios', 'ver'), async (req, res) => {
  const usuarios = await listarUsuarios({ verChatId: req.user!.rol === 'superadmin' });
  res.json({ usuarios });
});

/**
 * Enlace de Telegram. `:id` puede ser 'me' (el propio usuario) o el id de otra persona, lo que solo
 * puede hacer un superadmin. Se declara antes de las rutas '/:id' genéricas.
 */
function resolverObjetivoTelegram(
  req: { params: Record<string, unknown>; user?: { sub: string; rol: string } }
): { usuarioId: string; paraOtraPersona: boolean } | null {
  const param = String(req.params.id);
  const usuarioId = param === 'me' ? req.user!.sub : param;
  if (!puedeGestionarTelegramDe({ id: req.user!.sub, rol: req.user!.rol }, usuarioId)) return null;
  return { usuarioId, paraOtraPersona: usuarioId !== req.user!.sub };
}

router.post('/:id/telegram/generar-link', async (req, res) => {
  const objetivo = resolverObjetivoTelegram(req);
  if (!objetivo) {
    res.status(403).json({ error: 'Solo un superadmin puede enlazar el Telegram de otra persona.' });
    return;
  }
  const result = await generarLinkTelegramUsuario(objetivo.usuarioId);
  if ('error' in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  logger.info({
    evento: 'usuario_telegram_link_generado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    targetUserId: objetivo.usuarioId,
    paraOtraPersona: objetivo.paraOtraPersona,
  });
  res.json({
    deepLink: result.deepLink,
    expiraEn: result.expiraEn,
    paraOtraPersona: objetivo.paraOtraPersona,
    ...(objetivo.paraOtraPersona
      ? { aviso: 'Este enlace debe abrirlo la propia persona desde su Telegram; si lo abre otra, quedará enlazado el Telegram equivocado.' }
      : {}),
  });
});

router.delete('/:id/telegram', async (req, res) => {
  const objetivo = resolverObjetivoTelegram(req);
  if (!objetivo) {
    res.status(403).json({ error: 'Solo un superadmin puede desvincular el Telegram de otra persona.' });
    return;
  }
  const result = await desvincularTelegramUsuario(objetivo.usuarioId);
  if ('error' in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  logger.warn({
    evento: 'usuario_telegram_desvinculado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    targetUserId: objetivo.usuarioId,
    paraOtraPersona: objetivo.paraOtraPersona,
  });
  res.json({ ok: true });
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
    const result = await actualizarUsuarioAdmin(req.user!.sub, id, req.body);
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    logger.info({
      evento: 'usuario_actualizado',
      ip: clienteIp(req),
      adminId: req.user!.sub,
      targetUserId: id,
      cambios: Object.keys(req.body),
      ...(req.body.temaMarca !== undefined ? { temaMarca: req.body.temaMarca } : {}),
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
