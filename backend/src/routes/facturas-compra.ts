import { Router } from 'express';
import { listarFacturas, obtenerFactura, crearFactura } from '../services/factura-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { crearFacturaSchema } from '../schemas/facturas.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermiso('facturacion', 'ver'), async (req, res) => {
  const facturas = await listarFacturas('compra', {
    desde: req.query.desde ? String(req.query.desde) : undefined,
    hasta: req.query.hasta ? String(req.query.hasta) : undefined,
    entidadId: req.query.entidadId ? String(req.query.entidadId) : undefined,
    productoId: req.query.productoId ? String(req.query.productoId) : undefined,
  });
  res.json({ facturas });
});

router.get('/:id', requirePermiso('facturacion', 'ver'), async (req, res) => {
  const factura = await obtenerFactura('compra', String(req.params.id));
  if (!factura) {
    res.status(404).json({ error: 'Factura no encontrada.' });
    return;
  }
  res.json({ factura });
});

router.post(
  '/',
  requirePermiso('facturacion', 'crear'),
  validateBody(crearFacturaSchema),
  async (req, res) => {
    const result = await crearFactura('compra', req.body);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'factura_compra_creada',
      ip: clienteIp(req),
      userId: req.user!.sub,
      facturaId: result.factura.id,
      ticketId: result.factura.ticketId,
    });
    res.status(201).json(result);
  }
);

export default router;
