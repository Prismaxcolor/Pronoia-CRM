import { Router } from 'express';
import { listarExportaciones, MENSAJE_EXPORTACIONES_NO_LEIDAS } from '../services/exportaciones-service.js';
import { requireAuth, requirePermiso, reqTienePermiso } from '../middlewares/require-auth.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

// Una exportación es un packing list con cliente internacional: se ve con despachos:ver, igual que el packing list.
// La valoración (USD estimados y reales) es un dato de valor: solo viaja con facturacion:ver.
router.get('/', requirePermiso('despachos', 'ver'), async (req, res) => {
  try {
    res.json(await listarExportaciones({ puedeVerValores: reqTienePermiso(req, 'facturacion', 'ver') }));
  } catch (err) {
    logger.error({ evento: 'exportaciones_listado_error', ip: clienteIp(req), userId: req.user?.sub, motivo: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: MENSAJE_EXPORTACIONES_NO_LEIDAS });
  }
});

export default router;
