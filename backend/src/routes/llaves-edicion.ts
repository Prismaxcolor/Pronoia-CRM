import { Router } from 'express';
import { requireAuth, requireRol } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { crearLlaveSchema } from '../schemas/auditoria.js';
import { esSuperadminEnBd } from '../services/edicion-autorizada-service.js';
import { crearLlave } from '../services/llave-edicion-service.js';
import { edicionRequiereLlave, LLAVE_VIGENCIA_MINUTOS } from '../utils/llave-edicion.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

/** El frontend consulta esto para saber si debe pedirle llave al usuario actual. */
router.get('/config', (req, res) => {
  res.json({
    requiereLlave: edicionRequiereLlave(req.user!.rol),
    vigenciaMinutos: LLAVE_VIGENCIA_MINUTOS,
  });
});

/** Solo el superadmin entrega llaves. El código en claro se devuelve una única vez. */
router.post('/', requireRol('superadmin'), validateBody(crearLlaveSchema), async (req, res) => {
  const { entidadTipo, entidadId } = req.body;
  // El rol del JWT puede estar viejo (dura 7 días): se confirma en la BD.
  if (!(await esSuperadminEnBd(req.user!.sub))) {
    logger.warn({ evento: 'llave_edicion_generar_rechazada', userId: req.user!.sub, entidadTipo, entidadId });
    res.status(403).json({ error: 'No tienes permisos suficientes.' });
    return;
  }
  const result = await crearLlave(entidadTipo, entidadId, req.user!.sub);
  if ('error' in result) {
    res.status(result.codigo).json({ error: result.error });
    return;
  }
  logger.info({
    evento: 'llave_edicion_generada',
    ip: clienteIp(req),
    userId: req.user!.sub,
    entidadTipo,
    entidadId,
  });
  res.status(201).json(result);
});

export default router;
