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
import { requirePermisoOLlave } from '../middlewares/permiso-o-llave.js';
import { validarUuidParam } from '../middlewares/validate-uuid-param.js';
import { estadoCuentaTelegramLimiter } from '../middlewares/rate-limit.js';
import { validateBody } from '../middlewares/validate.js';
import { crearClienteSchema, actualizarClienteSchema } from '../schemas/clientes.js';
import { obtenerEstadoCuenta } from '../services/estado-cuenta-service.js';
import { generarLinkTelegram } from '../services/telegram-link-service.js';
import { enviarEstadoCuentaTelegram } from '../services/telegram-estado-cuenta-service.js';
import { crearNotaAjusteCliente, anularNotaAjusteClienteConLlave, obtenerNotaAjusteCliente } from '../services/nota-ajuste-cliente-service.js';
import { crearNotaAjusteSchema, anularNotaAjusteSchema } from '../schemas/notas-ajuste.js';
import { obtenerPagoDetalle } from '../services/pago-detalle-service.js';
import { listarAdelantosDisponibles } from '../services/cruce-service.js';
import { logger, clienteIp } from '../utils/logger.js';
import { responderSaldos } from './saldos-handler.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermiso('clientes', 'ver'), async (_req, res) => {
  const clientes = await listarClientes();
  res.json({ clientes });
});

// Saldos de todos los clientes (misma cifra que el estado de cuenta). Antes de las rutas '/:id'.
router.get('/saldos', requirePermiso('clientes', 'ver'), responderSaldos('cliente'));

router.get('/:id/estado-cuenta', requirePermiso('clientes', 'ver'), async (req, res) => {
  const { desde, hasta } = req.query;
  const estado = await obtenerEstadoCuenta(
    'cliente',
    String(req.params.id),
    desde ? String(desde) : undefined,
    hasta ? String(hasta) : undefined
  );
  if (!estado) {
    res.status(404).json({ error: 'Cliente no encontrado.' });
    return;
  }
  res.json(estado);
});

// Manda el estado de cuenta (versión externa, PDF) al Telegram de la entidad, a pedido del equipo.
router.post(
  '/:id/estado-cuenta/enviar-telegram',
  requirePermiso('clientes', 'editar'),
  validarUuidParam('id'),
  estadoCuentaTelegramLimiter,
  async (req, res) => {
    const id = String(req.params.id);
    const result = await enviarEstadoCuentaTelegram('cliente', id);
    if ('error' in result) {
      res.status(result.codigo).json({ error: result.error });
      return;
    }
    logger.info({ evento: 'cliente_estado_cuenta_telegram', ip: clienteIp(req), userId: req.user!.sub, clienteId: id });
    res.status(202).json({ ok: true });
  }
);

// Detalle de una nota (vista tipo "ticket" con impresión) — espejo de
// proveedores.ts, mismo permiso que el estado de cuenta, solo lectura.
router.get('/:id/notas-ajuste/:notaId', requirePermiso('clientes', 'ver'), async (req, res) => {
  const clienteId = String(req.params.id);
  const notaId = String(req.params.notaId);
  const result = await obtenerNotaAjusteCliente(clienteId, notaId);
  if ('error' in result) {
    res.status(404).json(result);
    return;
  }
  res.json({ nota: result });
});

// Comprobante imprimible de un cobro/anticipo (Bloque 48) — espejo de
// proveedores.ts, mismo permiso que el estado de cuenta, solo lectura.
router.get('/:id/pagos/:grupoId', requirePermiso('clientes', 'ver'), async (req, res) => {
  const clienteId = String(req.params.id);
  const grupoId = String(req.params.grupoId);
  const result = await obtenerPagoDetalle('cliente', clienteId, grupoId);
  if ('error' in result) {
    res.status(404).json(result);
    return;
  }
  res.json({ pago: result });
});

// Anticipos con saldo sin aplicar, para cruzarlos con facturas al registrar un cobro.
router.get('/:id/adelantos-disponibles', requirePermiso('clientes', 'ver'), async (req, res) => {
  const result = await listarAdelantosDisponibles('cliente', String(req.params.id));
  if ('error' in result) {
    res.status(500).json(result);
    return;
  }
  res.json({ adelantos: result });
});

// Ajuste manual del saldo (sin factura ni cobro real) → mismo permiso que
// editar el cliente, no 'cochinito' porque no mueve dinero de ninguna banca.
router.post(
  '/:id/notas-ajuste',
  requirePermiso('clientes', 'editar'),
  validateBody(crearNotaAjusteSchema),
  async (req, res) => {
    const clienteId = String(req.params.id);
    const result = await crearNotaAjusteCliente(clienteId, req.body, req.user!.sub);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'nota_ajuste_cliente_creada',
      ip: clienteIp(req),
      userId: req.user!.sub,
      clienteId,
      notaId: result.id,
      tipo: req.body.tipo,
    });
    res.status(201).json(result);
  }
);

router.post(
  '/:id/notas-ajuste/:notaId/anular',
  requirePermisoOLlave('clientes', 'editar'),
  validateBody(anularNotaAjusteSchema),
  async (req, res) => {
    const clienteId = String(req.params.id);
    const notaId = String(req.params.notaId);
    // Anular una nota exige llave de edición (o ser superadmin), igual que editar un ticket.
    const result = await anularNotaAjusteClienteConLlave(clienteId, notaId, req.body.motivo, {
      userId: req.user!.sub,
      email: req.user!.email,
      rol: req.user!.rol,
      llave: req.body.llaveEdicion,
    });
    if ('error' in result) {
      res.status(result.codigo).json({ error: result.error });
      return;
    }
    logger.info({
      evento: 'nota_ajuste_cliente_anulada',
      ip: clienteIp(req),
      userId: req.user!.sub,
      clienteId,
      notaId,
    });
    res.status(201).json(result);
  }
);

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

router.post(
  '/:id/telegram/generar-link',
  requirePermiso('clientes', 'editar'),
  async (req, res) => {
    const id = String(req.params.id);
    const result = await generarLinkTelegram('cliente', id);
    if ('error' in result) {
      const status = result.error.includes('no encontrado') ? 404 : 400;
      res.status(status).json(result);
      return;
    }
    logger.info({
      evento: 'cliente_telegram_link_generado',
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
