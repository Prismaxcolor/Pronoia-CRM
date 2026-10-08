import { Router, type Response } from 'express';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { validarUuidParam } from '../middlewares/validate-uuid-param.js';
import {
  actualizarCambistaSchema, anularAsientoSchema, crearAsientoSchema, crearCambistaSchema, filtroEstadoCuentaSchema,
} from '../schemas/mesa-cambio.js';
import {
  actualizarCambista, anularAsiento, crearAsiento, crearCambista, listarCambistas, obtenerEstadoCuenta,
} from '../services/mesa-cambio-service.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

/** Responde el fallo del servicio con su código HTTP. */
function responderFallo(res: Response, f: { error: string; codigo: number }): void {
  res.status(f.codigo).json({ error: f.error });
}

router.get('/cambistas', requirePermiso('mesa_cambio', 'ver'), async (_req, res) => {
  const r = await listarCambistas();
  if ('error' in r) return responderFallo(res, r);
  res.json(r);
});

router.post('/cambistas', requirePermiso('mesa_cambio', 'crear'), validateBody(crearCambistaSchema), async (req, res) => {
  const r = await crearCambista(req.body);
  if ('error' in r) return responderFallo(res, r);
  logger.info({ evento: 'cambista_creado', ip: clienteIp(req), userId: req.user!.sub, cambistaId: r.cambista.id });
  res.status(201).json(r);
});

router.patch(
  '/cambistas/:id',
  validarUuidParam('id'),
  requirePermiso('mesa_cambio', 'editar'),
  validateBody(actualizarCambistaSchema),
  async (req, res) => {
    const id = String(req.params.id);
    const r = await actualizarCambista(id, req.body);
    if ('error' in r) return responderFallo(res, r);
    logger.info({ evento: 'cambista_actualizado', ip: clienteIp(req), userId: req.user!.sub, cambistaId: id });
    res.json(r);
  },
);

router.get('/cambistas/:id/estado-cuenta', validarUuidParam('id'), requirePermiso('mesa_cambio', 'ver'), async (req, res) => {
  const filtro = filtroEstadoCuentaSchema.safeParse(req.query);
  if (!filtro.success) {
    res.status(400).json({ error: filtro.error.issues[0]?.message ?? 'Filtro inválido.' });
    return;
  }
  const { desde, hasta } = filtro.data;
  if (desde && hasta && desde > hasta) {
    res.status(400).json({ error: 'La fecha "desde" no puede ser posterior a "hasta".' });
    return;
  }
  const r = await obtenerEstadoCuenta(String(req.params.id), { desde, hasta });
  if ('error' in r) return responderFallo(res, r);
  res.json(r);
});

router.post('/asientos', requirePermiso('mesa_cambio', 'crear'), validateBody(crearAsientoSchema), async (req, res) => {
  const r = await crearAsiento(req.body, req.user!.sub);
  if ('error' in r) return responderFallo(res, r);
  logger.info({
    evento: 'asiento_mesa_cambio_creado', ip: clienteIp(req), userId: req.user!.sub,
    asientoId: r.asiento.id, tipo: r.asiento.tipo,
  });
  res.status(201).json(r);
});

// Anular exige el permiso 'editar' del módulo (los asientos no se borran). No usa llave de edición:
// las llaves están ligadas a tickets/pagos/movimientos y este módulo no mueve dinero real.
router.post(
  '/asientos/:id/anular',
  validarUuidParam('id'),
  requirePermiso('mesa_cambio', 'editar'),
  validateBody(anularAsientoSchema),
  async (req, res) => {
    const id = String(req.params.id);
    const r = await anularAsiento(id, req.body.motivo, req.user!.sub);
    if ('error' in r) return responderFallo(res, r);
    logger.info({ evento: 'asiento_mesa_cambio_anulado', ip: clienteIp(req), userId: req.user!.sub, asientoId: id });
    res.json(r);
  },
);

export default router;
