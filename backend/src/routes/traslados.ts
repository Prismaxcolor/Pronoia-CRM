import { Router } from 'express';
import { listarTraslados, obtenerTraslado } from '../services/traslado-service.js';
import { crearTrasladoIdempotente, completarTrasladoIdempotente } from '../services/operaciones-idempotentes.js';
import { responderErrorIdempotencia } from '../services/idempotencia-service.js';
import { validarUuidParam } from '../middlewares/validate-uuid-param.js';
import { rechazarCapturaAntigua } from '../middlewares/rechazar-captura-antigua.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { crearTrasladoSchema, completarTrasladoSchema } from '../schemas/traslados.js';
import { requirePermisoOLlave } from '../middlewares/permiso-o-llave.js';
import { editarTrasladoSchema, type EditarTrasladoInput } from '../schemas/traslados-editar.js';
import { editarTraslado } from '../services/traslado-edicion-service.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

// Traslado = otra operación de pesaje (al lado de compra/venta) → su propio permiso 'traslados'.

router.get('/', requirePermiso('traslados', 'ver'), async (_req, res) => {
  const traslados = await listarTraslados();
  res.json({ traslados });
});

router.get('/:id', requirePermiso('traslados', 'ver'), async (req, res) => {
  const traslado = await obtenerTraslado(String(req.params.id));
  if (!traslado) {
    res.status(404).json({ error: 'Traslado no encontrado.' });
    return;
  }
  res.json({ traslado });
});

router.post(
  '/',
  requirePermiso('traslados', 'crear'),
  validateBody(crearTrasladoSchema),
  async (req, res) => {
    let envio;
    try {
      envio = await crearTrasladoIdempotente(req.body, req.user!.sub);
    } catch (e) {
      if (responderErrorIdempotencia(res, e)) return;
      throw e;
    }
    const { resultado: result, repetida } = envio;
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'traslado_creado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      trasladoId: result.traslado.id,
    });
    res.status(repetida ? 200 : 201).json(repetida ? { ...result, repetida } : result);
  }
);

router.patch(
  '/:id/completar',
  validarUuidParam('id'),
  rechazarCapturaAntigua,
  requirePermiso('traslados', 'crear'),
  validateBody(completarTrasladoSchema),
  async (req, res) => {
    let envio;
    try {
      envio = await completarTrasladoIdempotente(String(req.params.id), req.body, req.user!.sub);
    } catch (e) {
      if (responderErrorIdempotencia(res, e)) return;
      throw e;
    }
    const { resultado: result, repetida } = envio;
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'traslado_completado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      trasladoId: result.traslado.id,
    });
    res.json(repetida ? { ...result, repetida } : result);
  }
);

// Edición de observaciones y pesos (enviado/recibido): protegida por llave y auditada.
// Los pesos recalculan stock de origen y destino en una transacción (editar_traslado_pesos).
router.patch(
  '/:id/editar',
  requirePermisoOLlave('traslados', 'editar'),
  validateBody(editarTrasladoSchema),
  async (req, res) => {
    const id = String(req.params.id);
    const { llaveEdicion, ...datos } = req.body as EditarTrasladoInput;
    const result = await editarTraslado(id, datos, {
      userId: req.user!.sub,
      email: req.user!.email,
      rol: req.user!.rol,
      llave: llaveEdicion || undefined,
    });
    if ('error' in result) {
      res.status(result.codigo).json({ error: result.error });
      return;
    }
    logger.info({ evento: 'traslado_editado', ip: clienteIp(req), userId: req.user!.sub, trasladoId: id });
    const { traslado, advertencia } = result;
    res.json({ traslado, ...(advertencia ? { advertencia } : {}) });
  }
);

export default router;
