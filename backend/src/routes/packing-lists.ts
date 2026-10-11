import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import {
  eliminarPackingList,
  guardarEmpresa,
  guardarPackingList,
  listarPackingLists,
  obtenerEmpresas,
  obtenerPackingList,
  MENSAJE_PACKING_NO_LEIDO,
} from '../services/packing-list-service.js';
import { listarOpcionesLotePacking, MENSAJE_LOTES_PACKING_NO_LEIDOS } from '../services/packing-list-lotes-service.js';
import { subirFotoPacking } from '../services/packing-list-fotos-service.js';
import { TAMANO_MAXIMO_FOTO_PACKING } from '../utils/packing-list-fotos.js';
import { requireAlgunPermiso, requireAuth, requirePermiso, reqTienePermiso } from '../middlewares/require-auth.js';
import { fotosPackingLimiter } from '../middlewares/rate-limit.js';
import { limitesSubidaImagen, mimeCoincideConFirma } from '../utils/firma-imagen.js';
import { validateBody, validateParams } from '../middlewares/validate.js';
import {
  empresaParamsSchema,
  guardarEmpresaSchema,
  guardarPackingListSchema,
  packingListParamsSchema,
} from '../schemas/packing-lists.js';
import { logger, clienteIp } from '../utils/logger.js';
import { validarUuidParam } from '../middlewares/validate-uuid-param.js';
import { rechazarCapturaAntigua } from '../middlewares/rechazar-captura-antigua.js';
import { cuerpoConRepetida, ejecutarOperacion, tipoDeRecurso, TIPO_OPERACION } from '../services/operaciones-idempotentes-cola.js';

const router = Router();

router.use(requireAuth);

// El packing list se arma al preparar un despacho/exportación → permiso 'despachos'
// (ver / crear / editar / eliminar). Los datos de la empresa (dirección por idioma) son
// configuración del documento: requieren 'editar'.

// La proyección de exportación es un dato de valor (USD estimados): solo con facturacion:ver, igual que el
// precio estimado de los lotes. Sin ese permiso no se lee, no se devuelve y no se modifica.
// El almacén y las fotos de las paletas y los kg disponibles por almacén son control interno de inventario: solo con
// permiso de inventario (productos:ver, el mismo de /api/inventario) o facturacion:ver, igual que la proyección.
// Sin él se omiten (no se leen, no se devuelven y la BD conserva lo guardado).
export const puedeVerControlInterno = (req: Request): boolean =>
  reqTienePermiso(req, 'productos', 'ver') || reqTienePermiso(req, 'facturacion', 'ver');

const opcionesValores = (req: Request) => ({
  puedeVerValores: reqTienePermiso(req, 'facturacion', 'ver'),
  puedeVerControl: puedeVerControlInterno(req),
});

function errorInterno(req: Request, res: Response, evento: string, err: unknown) {
  logger.error({ evento, ip: clienteIp(req), userId: req.user?.sub, motivo: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ error: MENSAJE_PACKING_NO_LEIDO });
}

// Foto de control interno de una paleta: va a un bucket PRIVADO y devuelve solo la ruta. Mismo permiso que
// armar el packing list (crear o editar). El tipo real se valida por la firma del contenido, no por el nombre.
const subirMemoria = multer({ storage: multer.memoryStorage(), limits: limitesSubidaImagen(TAMANO_MAXIMO_FOTO_PACKING) });

function recibirFoto(req: Request, res: Response, next: NextFunction) {
  subirMemoria.single('file')(req, res, err => {
    if (!err) return next();
    const grande = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
    res.status(400).json({ error: grande ? 'La foto pesa más de 6 MB. Toma otra o redúcela.' : 'Archivo inválido.' });
  });
}

router.post(
  '/fotos',
  requireAlgunPermiso({ recurso: 'despachos', accion: 'crear' }, { recurso: 'despachos', accion: 'editar' }),
  // Las fotos son control interno: sin permiso de inventario no se pueden ver después, así que tampoco se suben.
  (req, res, next) => {
    if (puedeVerControlInterno(req)) return next();
    res.status(403).json({ error: 'No tienes permiso para agregar fotos de control interno.' });
  },
  fotosPackingLimiter,
  recibirFoto,
  async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Falta la foto (campo "file").' });
      return;
    }
    if (!mimeCoincideConFirma(req.file.mimetype, req.file.buffer)) {
      res.status(400).json({ error: 'El tipo del archivo no coincide con su contenido.' });
      return;
    }
    try {
      const r = await subirFotoPacking(req.file.buffer);
      if (!r.ok) {
        res.status(r.status).json({ error: r.error });
        return;
      }
      logger.info({ evento: 'packing_foto_subida', ip: clienteIp(req), userId: req.user!.sub, ruta: r.ruta });
      res.status(201).json({ ruta: r.ruta });
    } catch (err) {
      errorInterno(req, res, 'packing_foto_error', err);
    }
  }
);

// Lotes de exportación con kg disponibles por almacén (control interno; solo lectura). Antes de '/:id'.
router.get('/lotes-exportacion', requirePermiso('despachos', 'ver'), async (req, res) => {
  try {
    res.json({ lotes: await listarOpcionesLotePacking({ puedeVerDisponible: puedeVerControlInterno(req) }) });
  } catch (err) {
    logger.error({ evento: 'packing_lotes_exportacion_error', ip: clienteIp(req), userId: req.user?.sub, motivo: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: MENSAJE_LOTES_PACKING_NO_LEIDOS });
  }
});

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
    const packingList = await obtenerPackingList(String(req.params.id), opcionesValores(req));
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
  const envio = await ejecutarOperacion(res, TIPO_OPERACION.packingListCrear, req.body, req.user!.sub, () =>
    guardarPackingList(null, req.body, req.user!.sub, opcionesValores(req))
  );
  if (!envio) return;
  const { resultado: result, repetida } = envio;
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  logger.info({ evento: 'packing_list_creado', ip: clienteIp(req), userId: req.user!.sub, packingListId: result.valor.id });
  res.status(repetida ? 200 : 201).json(cuerpoConRepetida({ packingList: result.valor }, repetida));
});

router.put(
  '/:id',
  validateParams(packingListParamsSchema),
  rechazarCapturaAntigua,
  requirePermiso('despachos', 'editar'),
  validateBody(guardarPackingListSchema),
  async (req, res) => {
    const id = String(req.params.id);
    const envio = await ejecutarOperacion(res, tipoDeRecurso(TIPO_OPERACION.packingListEditar, id), req.body, req.user!.sub, () =>
      guardarPackingList(id, req.body, req.user!.sub, opcionesValores(req))
    );
    if (!envio) return;
    const { resultado: result, repetida } = envio;
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    logger.info({ evento: 'packing_list_actualizado', ip: clienteIp(req), userId: req.user!.sub, packingListId: id });
    res.json(cuerpoConRepetida({ packingList: result.valor }, repetida));
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
