import { Router, type Request, type Response } from 'express';
import {
  eliminarPackingList,
  guardarEmpresa,
  guardarPackingList,
  listarPackingLists,
  obtenerEmpresas,
  obtenerPackingList,
  MENSAJE_PACKING_NO_LEIDO,
} from '../services/packing-list-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody, validateParams } from '../middlewares/validate.js';
import {
  empresaParamsSchema,
  guardarEmpresaSchema,
  guardarPackingListSchema,
  packingListParamsSchema,
} from '../schemas/packing-lists.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

// El packing list se arma al preparar un despacho/exportación → permiso 'despachos'
// (ver / crear / editar / eliminar). Los datos de la empresa (dirección por idioma) son
// configuración del documento: requieren 'editar'.

function errorInterno(req: Request, res: Response, evento: string, err: unknown) {
  logger.error({ evento, ip: clienteIp(req), userId: req.user?.sub, motivo: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ error: MENSAJE_PACKING_NO_LEIDO });
}

router.get('/', requirePermiso('despachos', 'ver'), async (req, res) => {
  try {
    res.json({ packingLists: await listarPackingLists() });
  } catch (err) {
    errorInterno(req, res, 'packing_lists_listado_error', err);
  }
});

// IMPORTANTE: declarar antes de '/:id' para que no lo capture la ruta dinámica.
router.get('/empresas', requirePermiso('despachos', 'ver'), async (req, res) => {
  try {
    res.json({ empresas: await obtenerEmpresas() });
  } catch (err) {
    errorInterno(req, res, 'packing_empresas_error', err);
  }
});

router.put(
  '/empresas/:idioma',
  requirePermiso('despachos', 'editar'),
  validateParams(empresaParamsSchema),
  validateBody(guardarEmpresaSchema),
  async (req, res) => {
    const idioma = req.params.idioma === 'en' ? 'en' : 'es';
    const result = await guardarEmpresa(idioma, req.body, req.user!.sub);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    logger.info({ evento: 'packing_empresa_actualizada', ip: clienteIp(req), userId: req.user!.sub, idioma });
    res.json({ empresa: result.valor });
  }
);

router.get('/:id', requirePermiso('despachos', 'ver'), validateParams(packingListParamsSchema), async (req, res) => {
  try {
    const packingList = await obtenerPackingList(String(req.params.id));
    if (!packingList) {
      res.status(404).json({ error: 'Packing list no encontrado.' });
      return;
    }
    res.json({ packingList });
  } catch (err) {
    errorInterno(req, res, 'packing_list_detalle_error', err);
  }
});

router.post('/', requirePermiso('despachos', 'crear'), validateBody(guardarPackingListSchema), async (req, res) => {
  const result = await guardarPackingList(null, req.body, req.user!.sub);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  logger.info({ evento: 'packing_list_creado', ip: clienteIp(req), userId: req.user!.sub, packingListId: result.valor.id });
  res.status(201).json({ packingList: result.valor });
});

router.put(
  '/:id',
  requirePermiso('despachos', 'editar'),
  validateParams(packingListParamsSchema),
  validateBody(guardarPackingListSchema),
  async (req, res) => {
    const id = String(req.params.id);
    const result = await guardarPackingList(id, req.body, req.user!.sub);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    logger.info({ evento: 'packing_list_actualizado', ip: clienteIp(req), userId: req.user!.sub, packingListId: id });
    res.json({ packingList: result.valor });
  }
);

router.delete('/:id', requirePermiso('despachos', 'eliminar'), validateParams(packingListParamsSchema), async (req, res) => {
  const id = String(req.params.id);
  const result = await eliminarPackingList(id);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  logger.warn({ evento: 'packing_list_eliminado', ip: clienteIp(req), userId: req.user!.sub, packingListId: id });
  res.json({ ok: true });
});

export default router;
