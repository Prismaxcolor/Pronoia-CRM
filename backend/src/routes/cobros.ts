import { Router } from 'express';
import { registrarCobroMultiple } from '../services/cobro-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { registrarCobroMultipleSchema } from '../schemas/cobros.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

// Espejo de POST /api/pagos/multiple — un cobro mueve dinero hacia una banca
// (Cochinito) → mismo permiso 'cochinito' que un pago.
router.post(
  '/multiple',
  requirePermiso('cochinito', 'crear'),
  validateBody(registrarCobroMultipleSchema),
  async (req, res) => {
    const result = await registrarCobroMultiple(req.body, req.user!.sub);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'cobro_cliente_multiple_registrado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      clienteId: req.body.clienteId,
      items: req.body.items.length,
      bancas: req.body.bancas.length,
      numeroCobro: result.numeroCobro,
      numeroAnticipo: result.numeroAnticipo,
    });
    res.status(201).json(result);
  }
);

export default router;
