import { Router } from 'express';
import {
  listarProveedores,
  crearProveedor,
  actualizarProveedor,
  desactivarProveedor,
  reactivarProveedor,
  borrarProveedor,
} from '../services/proveedor-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { crearProveedorSchema, actualizarProveedorSchema } from '../schemas/proveedores.js';
import { obtenerEstadoCuenta } from '../services/estado-cuenta-service.js';
import { generarLinkTelegram } from '../services/telegram-link-service.js';
import { crearNotaAjuste, anularNotaAjuste, obtenerNotaAjuste } from '../services/nota-ajuste-service.js';
import { crearNotaAjusteSchema, anularNotaAjusteSchema } from '../schemas/notas-ajuste.js';
import { obtenerPagoDetalle } from '../services/pago-detalle-service.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermiso('proveedores', 'ver'), async (_req, res) => {
  const proveedores = await listarProveedores();
  res.json({ proveedores });
});

router.get('/:id/estado-cuenta', requirePermiso('proveedores', 'ver'), async (req, res) => {
  const { desde, hasta } = req.query;
  const estado = await obtenerEstadoCuenta(
    'proveedor',
    String(req.params.id),
    desde ? String(desde) : undefined,
    hasta ? String(hasta) : undefined
  );
  if (!estado) {
    res.status(404).json({ error: 'Proveedor no encontrado.' });
    return;
  }
  res.json(estado);
});

// Detalle de una nota (vista tipo "ticket" con impresión) — mismo permiso
// que el estado de cuenta, solo lectura.
router.get('/:id/notas-ajuste/:notaId', requirePermiso('proveedores', 'ver'), async (req, res) => {
  const proveedorId = String(req.params.id);
  const notaId = String(req.params.notaId);
  const result = await obtenerNotaAjuste(proveedorId, notaId);
  if ('error' in result) {
    res.status(404).json(result);
    return;
  }
  res.json({ nota: result });
});

// Comprobante imprimible de un pago/adelanto (Bloque 48) — mismo permiso
// que el estado de cuenta, solo lectura.
router.get('/:id/pagos/:grupoId', requirePermiso('proveedores', 'ver'), async (req, res) => {
  const proveedorId = String(req.params.id);
  const grupoId = String(req.params.grupoId);
  const result = await obtenerPagoDetalle('proveedor', proveedorId, grupoId);
  if ('error' in result) {
    res.status(404).json(result);
    return;
  }
  res.json({ pago: result });
});

// Ajuste manual del saldo (sin factura ni pago real) → mismo permiso que editar
// el proveedor, no 'cochinito' porque no mueve dinero de ninguna banca.
router.post(
  '/:id/notas-ajuste',
  requirePermiso('proveedores', 'editar'),
  validateBody(crearNotaAjusteSchema),
  async (req, res) => {
    const proveedorId = String(req.params.id);
    const result = await crearNotaAjuste(proveedorId, req.body, req.user!.sub);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'nota_ajuste_proveedor_creada',
      ip: clienteIp(req),
      userId: req.user!.sub,
      proveedorId,
      notaId: result.id,
      tipo: req.body.tipo,
    });
    res.status(201).json(result);
  }
);

router.post(
  '/:id/notas-ajuste/:notaId/anular',
  requirePermiso('proveedores', 'editar'),
  validateBody(anularNotaAjusteSchema),
  async (req, res) => {
    const proveedorId = String(req.params.id);
    const notaId = String(req.params.notaId);
    const result = await anularNotaAjuste(proveedorId, notaId, req.body.motivo, req.user!.sub);
    if ('error' in result) {
      const status = result.error.includes('no encontrada') ? 404 : 400;
      res.status(status).json(result);
      return;
    }
    logger.info({
      evento: 'nota_ajuste_proveedor_anulada',
      ip: clienteIp(req),
      userId: req.user!.sub,
      proveedorId,
      notaOriginalId: notaId,
      notaNuevaId: result.id,
    });
    res.status(201).json(result);
  }
);

router.post(
  '/',
  requirePermiso('proveedores', 'crear'),
  validateBody(crearProveedorSchema),
  async (req, res) => {
    const result = await crearProveedor(req.body);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'proveedor_creado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      proveedorId: result.proveedor.id,
    });
    res.status(201).json(result);
  }
);

router.patch(
  '/:id',
  requirePermiso('proveedores', 'editar'),
  validateBody(actualizarProveedorSchema),
  async (req, res) => {
    const id = String(req.params.id);
    const result = await actualizarProveedor(id, req.body);
    if ('error' in result) {
      const status = result.error.includes('no encontrado') ? 404 : 400;
      res.status(status).json(result);
      return;
    }
    logger.info({
      evento: 'proveedor_actualizado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      proveedorId: id,
    });
    res.json(result);
  }
);

router.post(
  '/:id/telegram/generar-link',
  requirePermiso('proveedores', 'editar'),
  async (req, res) => {
    const id = String(req.params.id);
    const result = await generarLinkTelegram('proveedor', id);
    if ('error' in result) {
      const status = result.error.includes('no encontrado') ? 404 : 400;
      res.status(status).json(result);
      return;
    }
    logger.info({
      evento: 'proveedor_telegram_link_generado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      proveedorId: id,
    });
    res.json(result);
  }
);

router.post('/:id/desactivar', requirePermiso('proveedores', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const ok = await desactivarProveedor(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo desactivar el proveedor.' });
    return;
  }
  logger.info({
    evento: 'proveedor_desactivado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    proveedorId: id,
  });
  res.json({ ok: true });
});

router.post('/:id/reactivar', requirePermiso('proveedores', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const ok = await reactivarProveedor(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo reactivar el proveedor.' });
    return;
  }
  logger.info({
    evento: 'proveedor_reactivado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    proveedorId: id,
  });
  res.json({ ok: true });
});

router.delete('/:id', requirePermiso('proveedores', 'eliminar'), async (req, res) => {
  const id = String(req.params.id);
  const result = await borrarProveedor(id);
  if (!result.ok) {
    res.status(409).json({ error: result.razon });
    return;
  }
  logger.warn({
    evento: 'proveedor_borrado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    proveedorId: id,
  });
  res.json({ ok: true });
});

export default router;
