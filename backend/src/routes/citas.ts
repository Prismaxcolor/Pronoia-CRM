import { Router } from 'express';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { actualizarEstadoCitaSchema, crearCitaStaffSchema } from '../schemas/citas.js';
import { listarCitasStaff, actualizarEstadoCita, crearCita, HORARIOS_DISPONIBLES } from '../services/cita-despacho-service.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermiso('despachos', 'ver'), async (req, res) => {
  const { desde, hasta } = req.query;
  const citas = await listarCitasStaff(desde ? String(desde) : undefined, hasta ? String(hasta) : undefined);
  res.json({ citas });
});

// Declarada antes de '/:id/estado' para que no la capture ninguna ruta dinámica futura.
router.get('/horarios', requirePermiso('despachos', 'ver'), async (_req, res) => {
  res.json({ horarios: HORARIOS_DISPONIBLES });
});

/** Agendar por staff (walk-in / teléfono) — mismo servicio y misma validación
 *  de horario/colisión que usa el portal self-service, solo cambia quién
 *  elige la entidad. */
router.post('/', requirePermiso('despachos', 'crear'), validateBody(crearCitaStaffSchema), async (req, res) => {
  const { entidadTipo, entidadId, ...input } = req.body;
  const result = await crearCita(entidadTipo, entidadId, input);
  if ('error' in result) {
    res.status(409).json(result);
    return;
  }
  logger.info({
    evento: 'cita_despacho_creada_staff',
    ip: clienteIp(req),
    userId: req.user!.sub,
    citaId: result.cita.id,
  });
  res.status(201).json(result);
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
