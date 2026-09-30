import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { listarAuditoria } from '../services/auditoria-service.js';
import { paramsAuditoriaSchema } from '../schemas/auditoria.js';
import { RECURSO_POR_ENTIDAD } from '../utils/auditoria.js';

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

router.get('/:entidadTipo/:entidadId', requireLecturaDeEntidad, async (req, res) => {
  const { entidadTipo, entidadId } = paramsAuditoriaSchema.parse(req.params);
  const entradas = await listarAuditoria(entidadTipo, entidadId);
  res.json({ entradas });
});

export default router;
