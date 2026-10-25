import { Router } from 'express';
import { ejecutarOperacionFinanciera } from '../services/operacion-financiera.js';
import { TIPO_OPERACION, cuerpoConRepetida } from '../services/operaciones-idempotentes-cola.js';
import { registrarCobroMultiple } from '../services/cobro-service.js';
import { opcionesCategoriaCobro } from '../services/pago-categoria-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { requirePermisoOLlave } from '../middlewares/permiso-o-llave.js';
import { anularPagoCobro, editarPagoCobro } from '../services/pago-edicion-service.js';
import { validarUuidParam } from '../middlewares/validate-uuid-param.js';
import { anularTransaccionSchema, editarCobroSchema, type EditarPagoInput } from '../schemas/transacciones-editar.js';
import { validateBody } from '../middlewares/validate.js';
import { registrarCobroMultipleSchema } from '../schemas/cobros.js';
import { logger, clienteIp } from '../utils/logger.js';
import { exigirAccesoBancas } from '../middlewares/exigir-acceso-bancas.js';
import { idsBancasDeGrupo } from '../services/banca-acceso-service.js';

const router = Router();

router.use(requireAuth);

// Categorías entre las que se elige al cobrar (uso 'cobro_cliente'). Lista vacía = el cobro no pide categoría.
router.get('/categorias', requirePermiso('cochinito', 'crear'), async (_req, res) => {
  const result = await opcionesCategoriaCobro();
  if ('error' in result) {
    res.status(500).json({ error: result.error });
    return;
  }
  res.json({ categorias: result.categorias });
});

// Espejo de POST /api/pagos/multiple — un cobro mueve dinero hacia una banca
// (Cochinito) → mismo permiso 'cochinito' que un pago.
router.post(
  '/multiple',
  requirePermiso('cochinito', 'crear'),
  validateBody(registrarCobroMultipleSchema),
  exigirAccesoBancas(),
  async (req, res) => {
    // Con clientRequestId un doble clic o reintento no registra el cobro dos veces (responde 200 con `repetida`).
    const envio = await ejecutarOperacionFinanciera(res, TIPO_OPERACION.cobroClienteMultiple, req.body, req.user!.sub,
      () => registrarCobroMultiple(req.body, req.user!.sub));
    if (!envio) return;
    const { resultado: result, repetida } = envio;
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'cobro_cliente_multiple_registrado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      clienteId: req.body.clienteId,
      items: req.body.items.length,
      bancas: req.body.bancas.length,
      numeroCobro: result.numeroCobro,
      numeroAnticipo: result.numeroAnticipo,
      numeroCruce: result.numeroCruce,
      repetida,
    });
    res.status(repetida ? 200 : 201).json(cuerpoConRepetida(result, repetida));
  }
);

// Editar y anular un cobro (grupo de cobro a cliente) con llave de edición, como los tickets.
// Responde con el detalle actualizado en `cobro` (lo lee el aviso de Telegram).
router.patch(
  '/:grupoId',
  validarUuidParam('grupoId'),
  requirePermisoOLlave('cochinito', 'editar'),
  validateBody(editarCobroSchema),
  exigirAccesoBancas(req => idsBancasDeGrupo(String(req.params.grupoId))),
  async (req, res) => {
    const { llaveEdicion, ...datos } = req.body as EditarPagoInput;
    const grupoId = String(req.params.grupoId);
    const result = await editarPagoCobro('cobro', grupoId, datos, {
      userId: req.user!.sub, email: req.user!.email, rol: req.user!.rol, llave: llaveEdicion,
    });
    if ('error' in result) {
      res.status(result.codigo).json({ error: result.error });
      return;
    }
    logger.info({ evento: 'cobro_cliente_editado', ip: clienteIp(req), userId: req.user!.sub, grupoId });
    const { detalle, ...resto } = result;
    res.json({ cobro: detalle, ...resto });
  }
);

router.post(
  '/:grupoId/anular',
  validarUuidParam('grupoId'),
  requirePermisoOLlave('cochinito', 'editar'),
  validateBody(anularTransaccionSchema),
  exigirAccesoBancas(req => idsBancasDeGrupo(String(req.params.grupoId))),
  async (req, res) => {
    const grupoId = String(req.params.grupoId);
    const result = await anularPagoCobro('cobro', grupoId, req.body.motivo, {
      userId: req.user!.sub, email: req.user!.email, rol: req.user!.rol, llave: req.body.llaveEdicion,
    });
    if ('error' in result) {
      res.status(result.codigo).json({ error: result.error });
      return;
    }
    logger.info({ evento: 'cobro_cliente_anulado', ip: clienteIp(req), userId: req.user!.sub, grupoId });
    const { detalle, ...resto } = result;
    res.json({ cobro: detalle, ...resto });
  }
);

export default router;
