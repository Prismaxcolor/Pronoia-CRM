import { Router } from 'express';
import {
  listarBancas,
  listarMovimientos,
  crearBanca,
  actualizarBanca,
  archivarBanca,
  desarchivarBanca,
  crearMovimiento,
  obtenerDetalleMovimiento,
  leerTelegramChatIdBanca,
} from '../services/banca-service.js';
import { requireAuth, requirePermiso, reqTienePermiso } from '../middlewares/require-auth.js';
import { requirePermisoOLlave } from '../middlewares/permiso-o-llave.js';
import { anularMovimientoBanca, editarMovimientoBanca } from '../services/movimiento-edicion-service.js';
import { anularTransaccionSchema, editarMovimientoSchema, type EditarMovimientoInput } from '../schemas/transacciones-editar.js';
import { validarUuidParam } from '../middlewares/validate-uuid-param.js';
import { validateBody } from '../middlewares/validate.js';
import { crearBancaSchema, actualizarBancaSchema, crearMovimientoSchema } from '../schemas/cochinito.js';
import { logger, clienteIp } from '../utils/logger.js';
import { exigirAccesoBancas } from '../middlewares/exigir-acceso-bancas.js';
import { bancasPermitidas, concederBancaAUsuario, idsBancasDeMovimiento } from '../services/banca-acceso-service.js';
import { bancaPermitida, filtrarBancas, enmascararDetalleMovimiento, filtrarMovimientos, puedeCambiarTelegramBanca, MENSAJE_SIN_ACCESO_BANCA, MENSAJE_SOLO_ADMIN_TELEGRAM } from '../utils/banca-acceso.js';

const router = Router();

router.use(requireAuth);

router.get('/bancas', requirePermiso('cochinito', 'ver'), async (req, res) => {
  const incluirArchivadas = req.query.incluirArchivadas === 'true';
  const permitidas = await bancasPermitidas(req.user!.sub, req.user!.rol);
  const bancas = filtrarBancas(await listarBancas({ incluirArchivadas }), permitidas);
  res.json({ bancas });
});

router.post(
  '/bancas',
  requirePermiso('cochinito', 'crear'),
  validateBody(crearBancaSchema),
  async (req, res) => {
    if (req.body.telegramChatId && !puedeCambiarTelegramBanca(req.user!.rol)) {
      res.status(403).json({ error: MENSAJE_SOLO_ADMIN_TELEGRAM });
      return;
    }
    const result = await crearBanca(req.body);
    if ('error' in result) {
      res.status(result.pendiente ? 409 : 400).json({ error: result.error });
      return;
    }
    // Quien crea una banca debe poder usarla aunque no sea superadmin (el superadmin ve todas igual).
    const concedida = await concederBancaAUsuario(req.user!.sub, result.banca.id);
    if ('error' in concedida) {
      logger.error({ evento: 'banca_acceso_creador_fallido', userId: req.user!.sub, bancaId: result.banca.id, mensaje: concedida.error });
      if (!puedeCambiarTelegramBanca(req.user!.rol)) {
        // Sin acceso la cuenta quedaría invisible para quien la creó: se archiva (saldo 0) y se avisa.
        await archivarBanca(result.banca.id);
        res.status(500).json({ error: 'No se pudo asignarte acceso a la cuenta nueva; no se creó. Inténtalo de nuevo.' });
        return;
      }
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
  exigirAccesoBancas(async req => [String(req.params.id)]),
  async (req, res) => {
    const id = String(req.params.id);
    const nuevoChat: string | null | undefined = req.body.telegramChatId;
    const anteriorChat = nuevoChat === undefined ? null : await leerTelegramChatIdBanca(id);
    const cambiaChat = nuevoChat !== undefined && nuevoChat !== anteriorChat;
    if (cambiaChat && !puedeCambiarTelegramBanca(req.user!.rol)) {
      res.status(403).json({ error: MENSAJE_SOLO_ADMIN_TELEGRAM });
      return;
    }
    const result = await actualizarBanca(id, req.body);
    if ('error' in result) {
      const status = result.pendiente ? 409 : result.error.includes('no encontrada') ? 404 : 400;
      res.status(status).json({ error: result.error });
      return;
    }
    logger.info({
      evento: 'banca_actualizada',
      ip: clienteIp(req),
      userId: req.user!.sub,
      bancaId: id,
    });
    if (cambiaChat) {
      logger.info({ evento: 'banca_telegram_chat_modificado', userId: req.user!.sub, bancaId: id, anterior: anteriorChat, nuevo: nuevoChat });
    }
    res.json(result);
  }
);

router.post('/bancas/:id/archivar', requirePermiso('cochinito', 'editar'), exigirAccesoBancas(async req => [String(req.params.id)]), async (req, res) => {
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

router.post('/bancas/:id/desarchivar', requirePermiso('cochinito', 'editar'), exigirAccesoBancas(async req => [String(req.params.id)]), async (req, res) => {
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

router.get('/movimientos', requirePermiso('cochinito', 'ver'), async (req, res) => {
  const permitidas = await bancasPermitidas(req.user!.sub, req.user!.rol);
  const movimientos = filtrarMovimientos(await listarMovimientos(), permitidas);
  res.json({ movimientos });
});

// Detalle de un movimiento con los nombres resueltos. Los nombres de proveedor y cliente solo se
// incluyen si quien consulta puede verlos (mismo criterio que la tabla).
router.get('/movimientos/:id', validarUuidParam('id'), requirePermiso('cochinito', 'ver'), async (req, res) => {
  const detalle = await obtenerDetalleMovimiento(String(req.params.id), {
    verProveedores: reqTienePermiso(req, 'proveedores', 'ver'),
    verClientes: reqTienePermiso(req, 'clientes', 'ver'),
  });
  if (!detalle) {
    res.status(404).json({ error: 'Movimiento no encontrado.' });
    return;
  }
  const { bancaOrigenId, bancaDestinoId } = detalle.movimiento;
  const permitidas = await bancasPermitidas(req.user!.sub, req.user!.rol);
  const visible = bancaPermitida(permitidas, bancaOrigenId) || (bancaDestinoId !== null && bancaPermitida(permitidas, bancaDestinoId));
  if (!visible) {
    res.status(403).json({ error: MENSAJE_SIN_ACCESO_BANCA });
    return;
  }
  res.json(enmascararDetalleMovimiento(detalle, permitidas));
});

router.post(
  '/movimientos',
  requirePermiso('cochinito', 'crear'),
  validateBody(crearMovimientoSchema),
  exigirAccesoBancas(),
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

// Editar y anular un movimiento de banca manual con llave de edición, como los tickets.
// Responde con el movimiento actualizado en `movimiento` (lo lee el aviso de Telegram).
router.patch(
  '/movimientos/:id',
  validarUuidParam('id'),
  requirePermisoOLlave('cochinito', 'editar'),
  validateBody(editarMovimientoSchema),
  exigirAccesoBancas(req => idsBancasDeMovimiento(String(req.params.id))),
  async (req, res) => {
    const { llaveEdicion, ...datos } = req.body as EditarMovimientoInput;
    const id = String(req.params.id);
    const result = await editarMovimientoBanca(id, datos, {
      userId: req.user!.sub, email: req.user!.email, rol: req.user!.rol, llave: llaveEdicion,
    });
    if ('error' in result) {
      res.status(result.codigo).json({ error: result.error });
      return;
    }
    logger.info({ evento: 'movimiento_editado', ip: clienteIp(req), userId: req.user!.sub, movimientoId: id });
    res.json(result);
  }
);

router.post(
  '/movimientos/:id/anular',
  validarUuidParam('id'),
  requirePermisoOLlave('cochinito', 'editar'),
  validateBody(anularTransaccionSchema),
  exigirAccesoBancas(req => idsBancasDeMovimiento(String(req.params.id))),
  async (req, res) => {
    const id = String(req.params.id);
    const result = await anularMovimientoBanca(id, req.body.motivo, {
      userId: req.user!.sub, email: req.user!.email, rol: req.user!.rol, llave: req.body.llaveEdicion,
    });
    if ('error' in result) {
      res.status(result.codigo).json({ error: result.error });
      return;
    }
    logger.info({ evento: 'movimiento_anulado', ip: clienteIp(req), userId: req.user!.sub, movimientoId: id });
    res.json(result);
  }
);

export default router;
