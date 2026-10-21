import { Router } from 'express';
import { ejecutarOperacionFinanciera } from '../services/operacion-financiera.js';
import { TIPO_OPERACION, cuerpoConRepetida } from '../services/operaciones-idempotentes-cola.js';
import { registrarPago, registrarPagoMultiple } from '../services/pago-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { requirePermisoOLlave } from '../middlewares/permiso-o-llave.js';
import { anularPagoCobro, editarPagoCobro } from '../services/pago-edicion-service.js';
import { validarUuidParam } from '../middlewares/validate-uuid-param.js';
import { anularTransaccionSchema, editarPagoSchema, type EditarPagoInput } from '../schemas/transacciones-editar.js';
import { validateBody } from '../middlewares/validate.js';
import { registrarPagoSchema, registrarPagoMultipleSchema } from '../schemas/pagos.js';
import { logger, clienteIp } from '../utils/logger.js';
import { exigirCronSecret } from '../middlewares/exigir-cron-secret.js';
import { cronLimiter } from '../middlewares/rate-limit.js';
import { reintentarPasosPendientes } from '../services/pagos-pasos-service.js';
import { exigirAccesoBancas } from '../middlewares/exigir-acceso-bancas.js';
import { idsBancasDeGrupo } from '../services/banca-acceso-service.js';

const router = Router();

// Cron: reintenta los pasos posteriores de pagos/cobros que quedaron pendientes (categoría, comprobante, comisión).
// Va ANTES de requireAuth porque lo llama Vercel Cron con `Authorization: Bearer $CRON_SECRET`, sin sesión de usuario.
// Para programarlo: añadir a backend/vercel.json, en "crons", { "path": "/api/pagos/reintentar-pasos-pendientes", "schedule": "..." }.
router.all('/reintentar-pasos-pendientes', cronLimiter, exigirCronSecret, async (_req, res) => {
  const resumen = await reintentarPasosPendientes();
  logger.info({ evento: 'pagos_pasos_pendientes_reintentados', ...resumen });
  res.json(resumen);
});

router.use(requireAuth);

// Un pago mueve dinero de una banca (Cochinito) → permiso 'cochinito'.
router.post(
  '/',
  requirePermiso('cochinito', 'crear'),
  validateBody(registrarPagoSchema),
  exigirAccesoBancas(),
  async (req, res) => {
    // Con clientRequestId un doble clic o reintento no registra el pago dos veces (responde 200 con `repetida`).
    const envio = await ejecutarOperacionFinanciera(res, TIPO_OPERACION.pagoProveedorCrear, req.body, req.user!.sub,
      () => registrarPago(req.body, req.user!.sub));
    if (!envio) return;
    const { resultado: result, repetida } = envio;
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'pago_proveedor_registrado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      proveedorId: req.body.proveedorId,
      facturaId: req.body.facturaId ?? null,
      movimientoId: result.movimientoId,
      repetida,
    });
    res.status(repetida ? 200 : 201).json(cuerpoConRepetida(result, repetida));
  }
);

// "Registrar pago" combinado: una o varias facturas/notas de débito,
// repartido entre una o varias bancas; el excedente queda como adelanto.
router.post(
  '/multiple',
  requirePermiso('cochinito', 'crear'),
  validateBody(registrarPagoMultipleSchema),
  exigirAccesoBancas(),
  async (req, res) => {
    const envio = await ejecutarOperacionFinanciera(res, TIPO_OPERACION.pagoProveedorMultiple, req.body, req.user!.sub,
      () => registrarPagoMultiple(req.body, req.user!.sub));
    if (!envio) return;
    const { resultado: result, repetida } = envio;
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'pago_proveedor_multiple_registrado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      proveedorId: req.body.proveedorId,
      items: req.body.items.length,
      bancas: req.body.bancas.length,
      numeroPago: result.numeroPago,
      numeroAdelanto: result.numeroAdelanto,
      numeroCruce: result.numeroCruce,
      repetida,
    });
    res.status(repetida ? 200 : 201).json(cuerpoConRepetida(result, repetida));
  }
);

// Editar y anular un pago (grupo de pago a proveedor) con llave de edición, como los tickets.
// Responde con el detalle actualizado en `pago` (lo lee el aviso de Telegram).
router.patch(
  '/:grupoId',
  validarUuidParam('grupoId'),
  requirePermisoOLlave('cochinito', 'editar'),
  validateBody(editarPagoSchema),
  exigirAccesoBancas(req => idsBancasDeGrupo(String(req.params.grupoId))),
  async (req, res) => {
    const { llaveEdicion, ...datos } = req.body as EditarPagoInput;
    const grupoId = String(req.params.grupoId);
    const result = await editarPagoCobro('pago', grupoId, datos, {
      userId: req.user!.sub, email: req.user!.email, rol: req.user!.rol, llave: llaveEdicion,
    });
    if ('error' in result) {
      res.status(result.codigo).json({ error: result.error });
      return;
    }
    logger.info({ evento: 'pago_proveedor_editado', ip: clienteIp(req), userId: req.user!.sub, grupoId });
    const { detalle, ...resto } = result;
    res.json({ pago: detalle, ...resto });
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
    const result = await anularPagoCobro('pago', grupoId, req.body.motivo, {
      userId: req.user!.sub, email: req.user!.email, rol: req.user!.rol, llave: req.body.llaveEdicion,
    });
    if ('error' in result) {
      res.status(result.codigo).json({ error: result.error });
      return;
    }
    logger.info({ evento: 'pago_proveedor_anulado', ip: clienteIp(req), userId: req.user!.sub, grupoId });
    const { detalle, ...resto } = result;
    res.json({ pago: detalle, ...resto });
  }
);

export default router;
