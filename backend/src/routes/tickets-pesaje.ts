import { Router } from 'express';
import {
  listarTickets,
  obtenerTicket,
  crearTicket,
} from '../services/ticket-pesaje-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { crearTicketSchema } from '../schemas/tickets-pesaje.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

// El pesaje es parte del flujo de compra/facturación → permiso 'facturacion'.

router.get('/', requirePermiso('pesaje', 'ver'), async (req, res) => {
  const soloNoFacturados = req.query.soloNoFacturados === 'true';
  const entidadId = req.query.entidadId ? String(req.query.entidadId) : undefined;
  const tipo = req.query.tipo === 'venta' ? 'venta' : req.query.tipo === 'compra' ? 'compra' : undefined;
  const tickets = await listarTickets({ soloNoFacturados, entidadId, tipo });
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
    const result = await crearTicket(req.body);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'ticket_pesaje_creado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      ticketId: result.ticket.id,
    });
    res.status(201).json(result);
  }
);

export default router;
