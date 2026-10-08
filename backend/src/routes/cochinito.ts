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
} from '../services/banca-service.js';
import { requireAuth, requirePermiso, reqTienePermiso } from '../middlewares/require-auth.js';
import { requirePermisoOLlave } from '../middlewares/permiso-o-llave.js';
import { anularMovimientoBanca, editarMovimientoBanca } from '../services/movimiento-edicion-service.js';
import { anularTransaccionSchema, editarMovimientoSchema, type EditarMovimientoInput } from '../schemas/transacciones-editar.js';
import { validarUuidParam } from '../middlewares/validate-uuid-param.js';
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
  res.json(detalle);
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

// Editar y anular un movimiento de banca manual con llave de edición, como los tickets.
// Responde con el movimiento actualizado en `movimiento` (lo lee el aviso de Telegram).
router.patch(
  '/movimientos/:id',
  validarUuidParam('id'),
  requirePermisoOLlave('cochinito', 'editar'),
  validateBody(editarMovimientoSchema),
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
