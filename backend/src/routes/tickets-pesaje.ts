import { Router } from 'express';
import {
  listarTickets,
  obtenerTicket,
  crearTicket,
  completarTicket,
  editarTicket,
  borrarTicket,
} from '../services/ticket-pesaje-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { requirePermisoOLlave } from '../middlewares/permiso-o-llave.js';
import { crearTicketSchema, completarTicketSchema, editarTicketSchema } from '../schemas/tickets-pesaje.js';
import type { EditarTicketInput } from '../schemas/tickets-pesaje.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

// El pesaje es parte del flujo de compra/facturación → permiso 'facturacion'.

router.get('/', requirePermiso('pesaje', 'ver'), async (req, res) => {
  const soloNoFacturados = req.query.soloNoFacturados === 'true';
  const entidadId = req.query.entidadId ? String(req.query.entidadId) : undefined;
  const tipo = req.query.tipo === 'venta' ? 'venta' : req.query.tipo === 'compra' ? 'compra' : undefined;
  const estado = req.query.estado === 'bruto' ? 'bruto' : req.query.estado === 'completo' ? 'completo' : undefined;
  const tickets = await listarTickets({ soloNoFacturados, entidadId, tipo, estado });
  res.json({ tickets });
});

router.get('/:id', requirePermiso('pesaje', 'ver'), async (req, res) => {
  const ticket = await obtenerTicket(String(req.params.id));
  if (!ticket) {
    res.status(404).json({ error: 'Ticket no encontrado.' });
    return;
  }
  res.json({ ticket });
});

router.post(
  '/',
  requirePermiso('pesaje', 'crear'),
  validateBody(crearTicketSchema),
  async (req, res) => {
    const result = await crearTicket(req.body, req.user!.sub);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: result.ticket.estado === 'bruto' ? 'ticket_pesaje_bruto_creado' : 'ticket_pesaje_creado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      ticketId: result.ticket.id,
    });
    res.status(201).json(result);
  }
);

router.patch(
  '/:id/completar',
  requirePermiso('pesaje', 'crear'),
  validateBody(completarTicketSchema),
  async (req, res) => {
    const result = await completarTicket(String(req.params.id), req.body, req.user!.sub);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'ticket_pesaje_bruto_completado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      ticketId: result.ticket.id,
    });
    res.json(result);
  }
);

router.patch(
  '/:id',
  requirePermisoOLlave('pesaje', 'editar'),
  validateBody(editarTicketSchema),
  async (req, res) => {
    const { llaveEdicion, ...datos } = req.body as EditarTicketInput;
    const result = await editarTicket(String(req.params.id), datos, {
      userId: req.user!.sub,
      email: req.user!.email,
      rol: req.user!.rol,
      llave: llaveEdicion,
    });
    if ('error' in result) {
      res.status(result.codigo ?? 400).json({ error: result.error });
      return;
    }
    logger.info({
      evento: 'ticket_pesaje_editado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      ticketId: result.ticket.id,
    });
    res.json(result);
  }
);

router.delete('/:id', requirePermiso('pesaje', 'eliminar'), async (req, res) => {
  const id = String(req.params.id);
  const result = await borrarTicket(id);
  if (!result.ok) {
    res.status(result.noEncontrado ? 404 : 409).json({ error: result.razon });
    return;
  }
  logger.info({
    evento: 'ticket_pesaje_eliminado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    ticketId: id,
  });
  res.json({ ok: true });
});

export default router;
