import { Router } from 'express';
import {
  listarTransformaciones,
  reporteMerma,
  crearTransformacion,
  completarTransformacion,
  borrarTransformacion,
  crearTransformacionFerroso,
  completarTransformacionFerroso,
  obtenerSalidasComunes,
  guardarSalidasComunesProducto,
  crearTransformacionPCB,
  completarTransformacionPCB,
  completarTransformacionMixta,
} from '../services/transformacion-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { requirePermisoOLlave } from '../middlewares/permiso-o-llave.js';
import {
  crearTransformacionSchema,
  completarTransformacionSchema,
  crearTransformacionFerrosoSchema,
  completarTransformacionFerrosoSchema,
  guardarSalidasComunesSchema,
  crearTransformacionPCBSchema,
  completarTransformacionPCBSchema,
  completarTransformacionMixtaSchema,
} from '../schemas/transformaciones.js';
import { guardarValoracionSchema } from '../schemas/transformaciones-valoracion.js';
import { editarTransformacionSchema, type EditarTransformacionInput } from '../schemas/transformaciones-editar.js';
import { editarTransformacion } from '../services/transformacion-edicion-service.js';
import { editarMermaSchema, type EditarMermaInput } from '../schemas/merma-tipificada.js';
import { editarMermaTransformacion } from '../services/merma-tipificada-service.js';
import {
  guardarValoracion,
  obtenerTransformacionConValoracion,
} from '../services/transformacion-valoracion-service.js';
import { logger, clienteIp } from '../utils/logger.js';
import { validarUuidParam } from '../middlewares/validate-uuid-param.js';
import { rechazarCapturaAntigua } from '../middlewares/rechazar-captura-antigua.js';
import { cuerpoConRepetida, ejecutarOperacion, tipoDeRecurso, TIPO_OPERACION } from '../services/operaciones-idempotentes-cola.js';

const router = Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

router.get('/', requirePermiso('transformaciones', 'ver'), async (req, res) => {
  const desde = req.query.desde ? String(req.query.desde) : undefined;
  const hasta = req.query.hasta ? String(req.query.hasta) : undefined;
  const estado = req.query.estado === 'bruto' || req.query.estado === 'completa' ? req.query.estado : undefined;
  const categoria = req.query.categoria ? String(req.query.categoria) : undefined;
  const transformaciones = await listarTransformaciones({ desde, hasta, estado, categoria });
  res.json({ transformaciones });
});

// Histórico de merma derivado de transformaciones completas (antes de /:id).
router.get('/merma', requirePermiso('transformaciones', 'ver'), async (req, res) => {
  const q = (k: string) => (req.query[k] ? String(req.query[k]) : undefined);
  const agrupar = req.query.agrupar === 'dia' || req.query.agrupar === 'semana' ? req.query.agrupar : 'mes';
  const reporte = await reporteMerma({
    desde: q('desde'),
    hasta: q('hasta'),
    almacenId: q('almacenId'),
    productoId: q('productoId'),
    categoria: q('categoria'),
    agrupar,
  });
  res.json(reporte);
});

// ---------------------------------------------------------------------------
// Configuración: salidas comunes (antes de /:id para evitar shadowing)
// ---------------------------------------------------------------------------

router.get('/config/salidas-comunes', requirePermiso('transformaciones', 'ver'), async (req, res) => {
  const productoEntradaId = req.query.productoEntradaId ? String(req.query.productoEntradaId) : undefined;
  const salidas = await obtenerSalidasComunes(productoEntradaId);
  res.json({ salidas });
});

router.put(
  '/config/salidas-comunes/:productoId',
  requirePermiso('transformaciones', 'crear'),
  validateBody(guardarSalidasComunesSchema),
  async (req, res) => {
    const result = await guardarSalidasComunesProducto(
      String(req.params.productoId),
      req.body.productosSalidaIds
    );
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  }
);

router.get('/:id', requirePermiso('transformaciones', 'ver'), async (req, res) => {
  const transformacion = await obtenerTransformacionConValoracion(String(req.params.id));
  if (!transformacion) {
    res.status(404).json({ error: 'Transformación no encontrada.' });
    return;
  }
  res.json({ transformacion });
});

// ---------------------------------------------------------------------------
// Valoración (ancla opcional a factura de compra + precios editables)
// ---------------------------------------------------------------------------

router.patch(
  '/:id/valoracion',
  requirePermiso('transformaciones', 'editar'),
  validateBody(guardarValoracionSchema),
  async (req, res) => {
    const id = String(req.params.id);
    const result = await guardarValoracion(id, req.body, { userId: req.user!.sub, email: req.user!.email });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    logger.info({ evento: 'transformacion_valoracion_guardada', ip: clienteIp(req), userId: req.user!.sub, transformacionId: id });
    const transformacion = await obtenerTransformacionConValoracion(id);
    res.json({ transformacion });
  }
);

// Edición de fecha, notas y pesos (entrada y salidas): protegida por llave y auditada.
// Los pesos recalculan stock y se validan en una sola transacción (editar_transformacion_pesos).
router.patch(
  '/:id/editar',
  requirePermisoOLlave('transformaciones', 'editar'),
  validateBody(editarTransformacionSchema),
  async (req, res) => {
    const id = String(req.params.id);
    const { llaveEdicion, ...datos } = req.body as EditarTransformacionInput;
    const result = await editarTransformacion(id, datos, {
      userId: req.user!.sub,
      email: req.user!.email,
      rol: req.user!.rol,
      llave: llaveEdicion || undefined,
    });
    if ('error' in result) {
      res.status(result.codigo).json({ error: result.error });
      return;
    }
    logger.info({ evento: 'transformacion_editada', ip: clienteIp(req), userId: req.user!.sub, transformacionId: id });
    const { transformacion, avisos, advertencia } = result;
    res.json({ transformacion, ...(avisos ? { avisos } : {}), ...(advertencia ? { advertencia } : {}) });
  }
);

// Merma por tipo (basura, plástico, tierra, hierro, otro) de una transformación ya completada:
// reemplaza el desglose. Misma protección que /editar: permiso 'editar' o llave de un solo uso, y auditada.
router.patch(
  '/:id/merma',
  requirePermisoOLlave('transformaciones', 'editar'),
  validateBody(editarMermaSchema),
  async (req, res) => {
    const id = String(req.params.id);
    const { llaveEdicion, detalle } = req.body as EditarMermaInput;
    const result = await editarMermaTransformacion(id, detalle, {
      userId: req.user!.sub,
      email: req.user!.email,
      rol: req.user!.rol,
      llave: llaveEdicion || undefined,
    });
    if (!result.ok) {
      res.status(result.codigo).json({ error: result.error });
      return;
    }
    logger.info({ evento: 'transformacion_merma_editada', ip: clienteIp(req), userId: req.user!.sub, transformacionId: id });
    const transformacion = await obtenerTransformacionConValoracion(id).catch(() => null);
    res.json({ transformacion, desglose: result.desglose, ...(result.advertencia ? { advertencia: result.advertencia } : {}) });
  }
);

// ---------------------------------------------------------------------------
// Legacy (lote-pool)
// ---------------------------------------------------------------------------

router.post(
  '/',
  requirePermiso('transformaciones', 'crear'),
  validateBody(crearTransformacionSchema),
  async (req, res) => {
    const result = await crearTransformacion(req.body, req.user!.sub);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({ evento: 'transformacion_creada', ip: clienteIp(req), userId: req.user!.sub, transformacionId: result.transformacion.id });
    res.status(201).json(result);
  }
);

router.patch(
  '/:id/completar',
  requirePermiso('transformaciones', 'crear'),
  validateBody(completarTransformacionSchema),
  async (req, res) => {
    const result = await completarTransformacion(String(req.params.id), req.body, req.user!.sub);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({ evento: 'transformacion_completada', ip: clienteIp(req), userId: req.user!.sub, transformacionId: result.transformacion.id });
    res.json(result);
  }
);

// ---------------------------------------------------------------------------
// Ferroso / No Ferroso
// ---------------------------------------------------------------------------

router.post(
  '/ferroso',
  requirePermiso('transformaciones', 'crear'),
  validateBody(crearTransformacionFerrosoSchema),
  async (req, res) => {
    const envio = await ejecutarOperacion(res, TIPO_OPERACION.transformacionFerrosoCrear, req.body, req.user!.sub, () =>
      crearTransformacionFerroso(req.body, req.user!.sub)
    );
    if (!envio) return;
    const { resultado: result, repetida } = envio;
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({ evento: 'transformacion_ferroso_creada', ip: clienteIp(req), userId: req.user!.sub, transformacionId: result.transformacion.id });
    res.status(repetida ? 200 : 201).json(cuerpoConRepetida(result, repetida));
  }
);

router.patch(
  '/:id/completar-ferroso',
  validarUuidParam('id'),
  rechazarCapturaAntigua,
  requirePermiso('transformaciones', 'crear'),
  validateBody(completarTransformacionFerrosoSchema),
  async (req, res) => {
    const envio = await ejecutarOperacion(res, tipoDeRecurso(TIPO_OPERACION.transformacionFerrosoCompletar, String(req.params.id)), req.body, req.user!.sub, () =>
      completarTransformacionFerroso(String(req.params.id), req.body, req.user!.sub)
    );
    if (!envio) return;
    const { resultado: result, repetida } = envio;
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({ evento: 'transformacion_ferroso_completada', ip: clienteIp(req), userId: req.user!.sub, transformacionId: result.transformacion.id });
    res.json(cuerpoConRepetida(result, repetida));
  }
);

// ---------------------------------------------------------------------------
// PCB
// ---------------------------------------------------------------------------

router.post(
  '/pcb',
  requirePermiso('transformaciones', 'crear'),
  validateBody(crearTransformacionPCBSchema),
  async (req, res) => {
    const envio = await ejecutarOperacion(res, TIPO_OPERACION.transformacionPcbCrear, req.body, req.user!.sub, () =>
      crearTransformacionPCB(req.body, req.user!.sub)
    );
    if (!envio) return;
    const { resultado: result, repetida } = envio;
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({ evento: 'transformacion_pcb_creada', ip: clienteIp(req), userId: req.user!.sub, transformacionId: result.transformacion.id });
    res.status(repetida ? 200 : 201).json(cuerpoConRepetida(result, repetida));
  }
);

router.patch(
  '/:id/completar-pcb',
  validarUuidParam('id'),
  rechazarCapturaAntigua,
  requirePermiso('transformaciones', 'crear'),
  validateBody(completarTransformacionPCBSchema),
  async (req, res) => {
    const envio = await ejecutarOperacion(res, tipoDeRecurso(TIPO_OPERACION.transformacionPcbCompletar, String(req.params.id)), req.body, req.user!.sub, () =>
      completarTransformacionPCB(String(req.params.id), req.body, req.user!.sub)
    );
    if (!envio) return;
    const { resultado: result, repetida } = envio;
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({ evento: 'transformacion_pcb_completada', ip: clienteIp(req), userId: req.user!.sub, transformacionId: result.transformacion.id });
    res.json(cuerpoConRepetida(result, repetida));
  }
);

router.patch(
  '/:id/completar-mixta',
  validarUuidParam('id'),
  rechazarCapturaAntigua,
  requirePermiso('transformaciones', 'crear'),
  validateBody(completarTransformacionMixtaSchema),
  async (req, res) => {
    const envio = await ejecutarOperacion(res, tipoDeRecurso(TIPO_OPERACION.transformacionMixtaCompletar, String(req.params.id)), req.body, req.user!.sub, () =>
      completarTransformacionMixta(String(req.params.id), req.body, req.user!.sub)
    );
    if (!envio) return;
    const { resultado: result, repetida } = envio;
    if ('error' in result) {
      res.status(result.status ?? 400).json({ error: result.error });
      return;
    }
    logger.info({ evento: 'transformacion_mixta_completada', ip: clienteIp(req), userId: req.user!.sub, transformacionId: result.transformacion.id });
    res.json(cuerpoConRepetida(result, repetida));
  }
);

// ---------------------------------------------------------------------------
// Eliminar
// ---------------------------------------------------------------------------

router.delete('/:id', requirePermiso('transformaciones', 'eliminar'), async (req, res) => {
  const id = String(req.params.id);
  const result = await borrarTransformacion(id);
  if (!result.ok) {
    res.status(result.noEncontrado ? 404 : 409).json({ error: result.razon });
    return;
  }
  logger.info({ evento: 'transformacion_eliminada', ip: clienteIp(req), userId: req.user!.sub, transformacionId: id });
  res.json({ ok: true });
});

export default router;
