import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth, requirePermiso, reqTienePermiso } from '../middlewares/require-auth.js';
import { listarAuditoria } from '../services/auditoria-service.js';
import { paramsAuditoriaSchema } from '../schemas/auditoria.js';
import { RECURSO_POR_ENTIDAD, quitarPrecioEstimado } from '../utils/auditoria.js';
import { documentoVisible } from '../services/proveedor-documento.js';

const router = Router();

router.use(requireAuth);

/** Exige el permiso de lectura del recurso dueño del documento (pesaje, facturación, ...). */
function requireLecturaDeEntidad(req: Request, res: Response, next: NextFunction) {
  const params = paramsAuditoriaSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: 'Parámetros inválidos.' });
    return;
  }
  return requirePermiso(RECURSO_POR_ENTIDAD[params.data.entidadTipo], 'ver')(req, res, next);
}


/** El historial de un documento de un proveedor oculto (el proveedor, sus facturas, pagos, tickets, movimientos o notas) da 404 a quien no es superadmin. */
async function exigirDocumentoDeProveedorVisible(req: Request, res: Response, next: NextFunction) {
  const { entidadTipo, entidadId } = paramsAuditoriaSchema.parse(req.params);
  try {
    if (!(await documentoVisible(entidadTipo, entidadId))) {
      res.status(404).json({ error: 'No encontrado.' });
      return;
    }
    next();
  } catch {
    res.status(503).json({ error: 'No se pudo verificar el documento. Intenta de nuevo.' });
  }
}

router.get('/:entidadTipo/:entidadId', requireLecturaDeEntidad, exigirDocumentoDeProveedorVisible, async (req, res) => {
  const { entidadTipo, entidadId } = paramsAuditoriaSchema.parse(req.params);
  const entradas = await listarAuditoria(entidadTipo, entidadId);
  // El historial de un lote pide solo productos:ver, pero trae el precio estimado: va con facturacion:ver.
  const verPrecio = entidadTipo !== 'lote' || reqTienePermiso(req, 'facturacion', 'ver');
  res.json({ entradas: verPrecio ? entradas : quitarPrecioEstimado(entradas) });
});

export default router;
