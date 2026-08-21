import { Router } from 'express';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { obtenerMetricasCompras } from '../services/metricas-service.js';

const router = Router();

router.use(requireAuth);

const DIAS_MAX = 30;

/** GET /api/metricas/compras — líneas de compra de los últimos 30 días (el
 *  máximo que ofrece la UI); el frontend recorta a 15/7 sin volver a pedir.
 *  Mismo permiso que Dashboard — la página vive justo debajo en el menú. */
router.get('/compras', requirePermiso('dashboard', 'ver'), async (_req, res) => {
  const lineas = await obtenerMetricasCompras(DIAS_MAX);
  res.json({ lineas });
});

export default router;
