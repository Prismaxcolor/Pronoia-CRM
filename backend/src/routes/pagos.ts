import { Router } from 'express';
import { registrarPago } from '../services/pago-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { registrarPagoSchema } from '../schemas/pagos.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

// Un pago mueve dinero de una banca (Cochinito) → permiso 'cochinito'.
router.post(
  '/',
  requirePermiso('cochinito', 'crear'),
  validateBody(registrarPagoSchema),
  async (req, res) => {
    const result = await registrarPago(req.body, req.user!.sub);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'pago_proveedor_registrado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      proveedorId: req.body.proveedorId,
      facturaId: req.body.facturaId ?? null,
      movimientoId: result.movimientoId,
    });
    res.status(201).json(result);
  }
);

export default router;
