import { Router } from 'express';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { obtenerMetricasCompras } from '../services/metricas-service.js';

const router = Router();

router.use(requireAuth);

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function fechaMenosDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

/** GET /api/metricas/compras?desde=YYYY-MM-DD&hasta=YYYY-MM-DD — sin
 *  parámetros, default a los últimos 30 días. Mismo permiso que Dashboard —
 *  la página vive justo debajo en el menú. */
router.get('/compras', requirePermiso('dashboard', 'ver'), async (req, res) => {
  const desdeQ = typeof req.query.desde === 'string' ? req.query.desde : '';
  const hastaQ = typeof req.query.hasta === 'string' ? req.query.hasta : '';

  const desde = FECHA_RE.test(desdeQ) ? desdeQ : fechaMenosDias(30);
  const hasta = FECHA_RE.test(hastaQ) ? hastaQ : hoyISO();

  if (desde > hasta) {
    res.status(400).json({ error: '"desde" no puede ser posterior a "hasta".' });
    return;
  }

  const lineas = await obtenerMetricasCompras(desde, hasta);
  res.json({ lineas, desde, hasta });
});

export default router;
