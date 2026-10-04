import { Router, type Request, type Response } from 'express';
import { listarLotes, crearLote, actualizarLote, MENSAJE_CLASIFICACION_NO_HABILITADA } from '../services/lote-service.js';
import { listarEmbalajes, marcarEmbalado, anularEmbalaje } from '../services/lote-embalaje-service.js';
import { marcarEmbalajeSchema, anularEmbalajeSchema } from '../schemas/lote-embalajes.js';
import { invalidarCacheResumen } from '../services/resumen-cache.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody, validateParams } from '../middlewares/validate.js';
import { crearLoteSchema, actualizarLoteSchema, loteParamsSchema, embalajeParamsSchema } from '../schemas/lotes.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

// Los lotes son configuración de almacén → permiso 'productos'. Embalar (y anular un embalaje) es trabajo
// de planta: productos:editar. En cambio la CLASE del lote y su PRECIO ESTIMADO de venta alimentan las cifras
// de valor y de exportación que ve todo el equipo: solo superadmin (el nivel más alto que existe).
const MENSAJE_SOLO_SUPERADMIN = 'Solo un superadmin puede cambiar la clase o el precio estimado de un lote.';

function errorInterno(req: Request, res: Response, evento: string, err: unknown, mensaje: string) {
  logger.error({ evento, ip: clienteIp(req), userId: req.user?.sub, motivo: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ error: mensaje });
}

router.get('/', requirePermiso('productos', 'ver'), async (req, res) => {
  try {
    res.json({ lotes: await listarLotes() });
  } catch (err) {
    errorInterno(req, res, 'lotes_listado_error', err, 'No se pudieron leer los lotes. Intenta de nuevo.');
  }
});

router.post(
  '/',
  requirePermiso('productos', 'crear'),
  validateBody(crearLoteSchema),
  async (req, res) => {
    const result = await crearLote(req.body);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({ evento: 'lote_creado', ip: clienteIp(req), userId: req.user!.sub, loteId: result.lote.id });
    res.status(201).json(result);
  }
);

router.patch(
  '/:id',
  requirePermiso('productos', 'editar'),
  validateParams(loteParamsSchema),
  validateBody(actualizarLoteSchema),
  async (req, res) => {
    const id = String(req.params.id);
    const cambiaClasificacion = req.body.clase !== undefined || req.body.precioEstimadoKg !== undefined;
    if (cambiaClasificacion && req.user!.rol !== 'superadmin') {
      res.status(403).json({ error: MENSAJE_SOLO_SUPERADMIN });
      return;
    }
    try {
      const result = await actualizarLote(id, req.body, { userId: req.user!.sub, email: req.user!.email });
      if ('error' in result) {
        const status =
          result.error.includes('no encontrado') ? 404 : result.error === MENSAJE_CLASIFICACION_NO_HABILITADA ? 409 : 400;
        res.status(status).json(result);
        return;
      }
      invalidarCacheResumen();
      logger.info({ evento: 'lote_actualizado', ip: clienteIp(req), userId: req.user!.sub, loteId: id });
      res.json(result);
    } catch (err) {
      errorInterno(req, res, 'lote_actualizar_error', err, 'No se pudo actualizar el lote. Intenta de nuevo.');
    }
  }
);

// ---------------------------------------------------------------------------
// Embalado por kilos
// ---------------------------------------------------------------------------

router.get('/:id/embalajes', requirePermiso('productos', 'ver'), validateParams(loteParamsSchema), async (req, res) => {
  const incluirAnulados = req.query.incluirAnulados === 'true';
  try {
    res.json({ embalajes: await listarEmbalajes(String(req.params.id), { incluirAnulados }) });
  } catch (err) {
    errorInterno(req, res, 'lote_embalajes_listado_error', err, 'No se pudieron leer los embalajes. Intenta de nuevo.');
  }
});

router.post(
  '/:id/embalajes',
  requirePermiso('productos', 'editar'),
  validateParams(loteParamsSchema),
  validateBody(marcarEmbalajeSchema),
  async (req, res) => {
    const loteId = String(req.params.id);
    const result = await marcarEmbalado(loteId, req.body, { userId: req.user!.sub, email: req.user!.email });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    invalidarCacheResumen();
    logger.info({ evento: 'lote_embalado', ip: clienteIp(req), userId: req.user!.sub, loteId, embalajeId: result.embalaje.id, pesoKg: result.embalaje.pesoKg });
    res.status(201).json({ embalaje: result.embalaje, ...(result.advertencia ? { advertencia: result.advertencia } : {}) });
  }
);

router.post(
  '/:id/embalajes/:embalajeId/anular',
  requirePermiso('productos', 'editar'),
  validateParams(embalajeParamsSchema),
  validateBody(anularEmbalajeSchema),
  async (req, res) => {
    const loteId = String(req.params.id);
    const embalajeId = String(req.params.embalajeId);
    const result = await anularEmbalaje(loteId, embalajeId, req.body.motivo, { userId: req.user!.sub, email: req.user!.email });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    invalidarCacheResumen();
    logger.info({ evento: 'lote_embalaje_anulado', ip: clienteIp(req), userId: req.user!.sub, loteId, embalajeId });
    res.json({ embalaje: result.embalaje, ...(result.advertencia ? { advertencia: result.advertencia } : {}) });
  }
);

export default router;
