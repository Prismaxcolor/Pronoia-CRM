import { Router } from 'express';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { actualizarEstadoCitaSchema } from '../schemas/citas.js';
import { listarCitasStaff, actualizarEstadoCita } from '../services/cita-despacho-service.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermiso('despachos', 'ver'), async (req, res) => {
  const { desde, hasta } = req.query;
  const citas = await listarCitasStaff(desde ? String(desde) : undefined, hasta ? String(hasta) : undefined);
  res.json({ citas });
});

router.patch('/:id/estado', requirePermiso('despachos', 'editar'), validateBody(actualizarEstadoCitaSchema), async (req, res) => {
  const cita = await actualizarEstadoCita(String(req.params.id), req.body.estado);
  if (!cita) {
    res.status(404).json({ error: 'Cita no encontrada.' });
    return;
  }
  res.json({ cita });
});

export default router;
