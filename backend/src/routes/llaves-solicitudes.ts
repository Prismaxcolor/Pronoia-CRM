import { timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { obtenerSecreto } from '../config/secretos.js';
import { requireAuth, requireRol } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { validarUuidParam } from '../middlewares/validate-uuid-param.js';
import {
  crearSolicitudLlaveSchema,
  listarSolicitudesQuerySchema,
  rechazarSolicitudLlaveSchema,
  telegramCallbackSchema,
} from '../schemas/solicitudes-llave.js';
import { esSuperadminEnBd } from '../services/edicion-autorizada-service.js';
import {
  aprobarSolicitud,
  contarPendientes,
  crearSolicitud,
  listarMias,
  listarPorEstado,
  obtenerSolicitud,
  rechazarSolicitud,
  type ResultadoSolicitud,
} from '../services/solicitud-llave-service.js';
import { resolverDesdeTelegram } from '../services/solicitud-llave-telegram.js';
import { logger } from '../utils/logger.js';

const router = Router();

/** 3 solicitudes nuevas por minuto y 15 por hora por usuario: evita spamear el Telegram del superadmin. */
const claveUsuario = (req: Request) => req.user?.sub ?? ipKeyGenerator(req.ip ?? 'na');
const opcionesLimite = {
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  skipFailedRequests: true,
  keyGenerator: claveUsuario,
};
const limitePorMinuto = rateLimit({
  ...opcionesLimite,
  windowMs: 60_000,
  limit: 3,
  message: { error: 'Estás pidiendo llaves muy seguido. Espera un minuto y reintenta.' },
});
const limitePorHora = rateLimit({
  ...opcionesLimite,
  windowMs: 60 * 60_000,
  limit: 15,
  message: { error: 'Llegaste al máximo de solicitudes por hora. Avisa directamente a un administrador.' },
});

function responder<T>(res: Response, resultado: ResultadoSolicitud<T>, statusOk = 200): void {
  if (!resultado.ok) {
    res.status(resultado.codigo).json({ error: resultado.error });
    return;
  }
  res.status(statusOk).json(resultado.data);
}

/** El rol del JWT puede estar viejo (dura 7 días): para aprobar se confirma en la BD. */
async function exigirSuperadminBd(req: Request, res: Response): Promise<boolean> {
  if (await esSuperadminEnBd(req.user!.sub)) return true;
  logger.warn({ evento: 'solicitud_llave_resolver_rechazado', userId: req.user!.sub });
  res.status(403).json({ error: 'No tienes permisos suficientes.' });
  return false;
}

const HEADER_SECRETO = 'x-pronoia-secret';

/** Comparación en tiempo constante; longitudes distintas ya implican que no coinciden. */
function secretosIguales(recibido: string, esperado: string): boolean {
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Autentica al flujo de n8n con X-Pronoia-Secret (N8N_WEBHOOK_SECRET). Sin secreto configurado se rechaza todo. */
async function exigirSecretoN8n(req: Request, res: Response, next: NextFunction): Promise<void> {
  const esperado = await obtenerSecreto('N8N_WEBHOOK_SECRET');
  const recibido = req.header(HEADER_SECRETO);
  if (!esperado || !recibido || !secretosIguales(recibido, esperado)) {
    logger.warn({ evento: 'llave_callback_secreto_invalido', ip: req.ip });
    res.status(401).json({ error: 'No autorizado.' });
    return;
  }
  next();
}

/** 60 pulsaciones por minuto por IP: holgado para los botones y estrecho frente a fuerza bruta del secreto. */
const limiteCallback = rateLimit({
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  windowMs: 60_000,
  limit: 60,
  keyGenerator: req => ipKeyGenerator(req.ip ?? 'na'),
  message: { error: 'Demasiadas solicitudes.' },
});

// Sin JWT: lo llama n8n cuando un superadmin toca Aprobar/Rechazar en su chat privado. Va ANTES de requireAuth.
router.post('/telegram-callback', limiteCallback, exigirSecretoN8n, validateBody(telegramCallbackSchema), async (req, res) => {
  const { telegramUserId, callbackData } = req.body as { telegramUserId: string; callbackData: string };
  res.status(200).json(await resolverDesdeTelegram({ telegramUserId, callbackData }));
});

router.use(requireAuth);

router.post('/', limitePorMinuto, limitePorHora, validateBody(crearSolicitudLlaveSchema), async (req, res) => {
  const { entidadTipo, entidadId, motivo } = req.body;
  const resultado = await crearSolicitud({ userId: req.user!.sub, email: req.user!.email }, entidadTipo, entidadId, motivo);
  if (!resultado.ok) {
    res.status(resultado.codigo).json({ error: resultado.error });
    return;
  }
  res.status(resultado.data.existente ? 200 : 201).json(resultado.data);
});

router.get('/mias', async (req, res) => {
  responder(res, await listarMias(req.user!.sub));
});

router.get('/pendientes/conteo', requireRol('superadmin'), async (req, res) => {
  if (!(await exigirSuperadminBd(req, res))) return;
  const resultado = await contarPendientes();
  if (!resultado.ok) {
    res.status(resultado.codigo).json({ error: resultado.error });
    return;
  }
  res.json({ pendientes: resultado.data });
});

router.get('/', requireRol('superadmin'), async (req, res) => {
  const query = listarSolicitudesQuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: 'Estado inválido.' });
    return;
  }
  if (!(await exigirSuperadminBd(req, res))) return;
  responder(res, await listarPorEstado(query.data.estado));
});

router.get('/:id', validarUuidParam(), async (req, res) => {
  const esSuperadmin = req.user!.rol === 'superadmin' && (await esSuperadminEnBd(req.user!.sub));
  responder(res, await obtenerSolicitud(String(req.params.id), req.user!.sub, esSuperadmin));
});

router.post('/:id/aprobar', requireRol('superadmin'), validarUuidParam(), async (req, res) => {
  if (!(await exigirSuperadminBd(req, res))) return;
  responder(res, await aprobarSolicitud(String(req.params.id), req.user!.sub));
});

router.post('/:id/rechazar', requireRol('superadmin'), validarUuidParam(), validateBody(rechazarSolicitudLlaveSchema), async (req, res) => {
  if (!(await exigirSuperadminBd(req, res))) return;
  responder(res, await rechazarSolicitud(String(req.params.id), req.user!.sub, req.body.motivo));
});

export default router;
