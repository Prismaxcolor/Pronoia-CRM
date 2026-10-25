import { Router } from 'express';
import { ejecutarOperacionFinanciera } from '../services/operacion-financiera.js';
import {
  listarProveedores,
  crearProveedor,
  actualizarProveedor,
  desactivarProveedor,
  reactivarProveedor,
  borrarProveedor,
} from '../services/proveedor-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { requirePermisoOLlave } from '../middlewares/permiso-o-llave.js';
import { validarUuidParam } from '../middlewares/validate-uuid-param.js';
import { estadoCuentaTelegramLimiter } from '../middlewares/rate-limit.js';
import { validateBody } from '../middlewares/validate.js';
import { crearProveedorSchema, actualizarProveedorSchema } from '../schemas/proveedores.js';
import { obtenerEstadoCuenta } from '../services/estado-cuenta-service.js';
import { generarLinkTelegram } from '../services/telegram-link-service.js';
import { enviarEstadoCuentaTelegram } from '../services/telegram-estado-cuenta-service.js';
import { crearNotaAjuste, anularNotaAjusteConLlave, obtenerNotaAjuste } from '../services/nota-ajuste-service.js';
import { crearNotaAjusteSchema, anularNotaAjusteSchema, actualizarCategoriaNotaSchema } from '../schemas/notas-ajuste.js';
import { asignarCategoriaNota } from '../services/categoria-nota-service.js';
import { obtenerPagoDetalle } from '../services/pago-detalle-service.js';
import { listarAdelantosDisponibles } from '../services/cruce-service.js';
import { cambioReportesNoPermitido } from '../services/grupo-silencio-service.js';
import { MENSAJE_SOLO_ADMIN_REPORTES_TELEGRAM } from '../utils/banca-acceso.js';
import { logger, clienteIp } from '../utils/logger.js';
import { registrarAuditoria } from '../services/auditoria-service.js';
import { bancasPermitidas } from '../services/banca-acceso-service.js';
import { conOperacionCliente, cuerpoConRepetida, ejecutarOperacion, TIPO_OPERACION, tipoDeRecurso } from '../services/operaciones-idempotentes-cola.js';
import { responderSaldos } from './saldos-handler.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermiso('proveedores', 'ver'), async (_req, res) => {
  const proveedores = await listarProveedores();
  res.json({ proveedores });
});

// Saldos de todos los proveedores (misma cifra que el estado de cuenta). Antes de las rutas '/:id'.
router.get('/saldos', requirePermiso('proveedores', 'ver'), responderSaldos('proveedor'));

router.get('/:id/estado-cuenta', requirePermiso('proveedores', 'ver'), async (req, res) => {
  const { desde, hasta } = req.query;
  const estado = await obtenerEstadoCuenta(
    'proveedor',
    String(req.params.id),
    desde ? String(desde) : undefined,
    hasta ? String(hasta) : undefined,
    // Las filas se muestran completas (saldo exacto); solo se ocultan las referencias de cuentas sin acceso.
    await bancasPermitidas(req.user!.sub, req.user!.rol)
  );
  if (!estado) {
    res.status(404).json({ error: 'Proveedor no encontrado.' });
    return;
  }
  res.json(estado);
});

// Manda el estado de cuenta (versión externa, PDF) al Telegram de la entidad, a pedido del equipo.
router.post(
  '/:id/estado-cuenta/enviar-telegram',
  requirePermiso('proveedores', 'editar'),
  validarUuidParam('id'),
  estadoCuentaTelegramLimiter,
  async (req, res) => {
    const id = String(req.params.id);
    const result = await enviarEstadoCuentaTelegram('proveedor', id);
    if ('error' in result) {
      res.status(result.codigo).json({ error: result.error });
      return;
    }
    logger.info({ evento: 'proveedor_estado_cuenta_telegram', ip: clienteIp(req), userId: req.user!.sub, proveedorId: id });
    res.status(202).json({ ok: true });
  }
);

// Detalle de una nota (vista tipo "ticket" con impresión) — mismo permiso
// que el estado de cuenta, solo lectura.
router.get('/:id/notas-ajuste/:notaId', requirePermiso('proveedores', 'ver'), async (req, res) => {
  const proveedorId = String(req.params.id);
  const notaId = String(req.params.notaId);
  const result = await obtenerNotaAjuste(proveedorId, notaId);
  if ('error' in result) {
    res.status(404).json(result);
    return;
  }
  res.json({ nota: result });
});

// Comprobante imprimible de un pago/adelanto (Bloque 48) — mismo permiso
// que el estado de cuenta, solo lectura.
router.get('/:id/pagos/:grupoId', requirePermiso('proveedores', 'ver'), async (req, res) => {
  const proveedorId = String(req.params.id);
  const grupoId = String(req.params.grupoId);
  const result = await obtenerPagoDetalle('proveedor', proveedorId, grupoId, await bancasPermitidas(req.user!.sub, req.user!.rol));
  if ('error' in result) {
    res.status(404).json(result);
    return;
  }
  res.json({ pago: result });
});

// Adelantos con saldo sin aplicar, para cruzarlos con facturas al registrar un pago.
router.get('/:id/adelantos-disponibles', requirePermiso('proveedores', 'ver'), async (req, res) => {
  const result = await listarAdelantosDisponibles('proveedor', String(req.params.id));
  if ('error' in result) {
    res.status(500).json(result);
    return;
  }
  res.json({ adelantos: result });
});

// Ajuste manual del saldo (sin factura ni pago real) → mismo permiso que editar
// el proveedor, no 'cochinito' porque no mueve dinero de ninguna banca.
router.post(
  '/:id/notas-ajuste',
  validarUuidParam('id'),
  requirePermiso('proveedores', 'editar'),
  validateBody(crearNotaAjusteSchema),
  async (req, res) => {
    const proveedorId = String(req.params.id);
    // Con clientRequestId un doble clic o reintento no crea una segunda nota (responde 200 con `repetida`).
    const envio = await ejecutarOperacionFinanciera(res, tipoDeRecurso(TIPO_OPERACION.notaAjusteProveedorCrear, proveedorId), req.body, req.user!.sub,
      () => crearNotaAjuste(proveedorId, req.body, req.user!.sub));
    if (!envio) return;
    const { resultado: result, repetida } = envio;
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'nota_ajuste_proveedor_creada',
      ip: clienteIp(req),
      userId: req.user!.sub,
      proveedorId,
      notaId: result.id,
      tipo: req.body.tipo,
      repetida,
    });
    res.status(repetida ? 200 : 201).json(cuerpoConRepetida(result, repetida));
  }
);

router.post(
  '/:id/notas-ajuste/:notaId/anular',
  requirePermisoOLlave('proveedores', 'editar'),
  validateBody(anularNotaAjusteSchema),
  async (req, res) => {
    const proveedorId = String(req.params.id);
    const notaId = String(req.params.notaId);
    // Anular una nota exige llave de edición (o ser superadmin), igual que editar un ticket.
    const result = await anularNotaAjusteConLlave(proveedorId, notaId, req.body.motivo, {
      userId: req.user!.sub,
      email: req.user!.email,
      rol: req.user!.rol,
      llave: req.body.llaveEdicion,
    });
    if ('error' in result) {
      res.status(result.codigo).json({ error: result.error });
      return;
    }
    logger.info({
      evento: 'nota_ajuste_proveedor_anulada',
      ip: clienteIp(req),
      userId: req.user!.sub,
      proveedorId,
      notaId,
    });
    res.status(201).json(result);
  }
);

// Cambia solo la categoría de una nota (no toca montos ni saldos, por eso no pide llave de edición).
router.patch(
  '/:id/notas-ajuste/:notaId/categoria',
  requirePermiso('proveedores', 'editar'),
  validarUuidParam('id'),
  validarUuidParam('notaId'),
  validateBody(actualizarCategoriaNotaSchema),
  async (req, res) => {
    const proveedorId = String(req.params.id);
    const notaId = String(req.params.notaId);
    const result = await asignarCategoriaNota('notas_ajuste_proveedor', 'proveedor_id', proveedorId, notaId, req.body.categoriaId);
    if ('error' in result) {
      res.status(result.codigo).json({ error: result.error });
      return;
    }
    await registrarAuditoria({
      entidadTipo: 'nota_ajuste_proveedor',
      entidadId: notaId,
      accion: 'cambiar_categoria',
      usuarioId: req.user!.sub,
      usuarioEmail: req.user!.email,
      cambios: { categoria_id: { antes: result.anterior, despues: req.body.categoriaId } },
    });
    logger.info({
      evento: 'nota_ajuste_proveedor_categoria_cambiada',
      ip: clienteIp(req),
      userId: req.user!.sub,
      proveedorId,
      notaId,
      categoriaId: req.body.categoriaId,
    });
    res.json({ ok: true });
  }
);

router.post(
  '/',
  requirePermiso('proveedores', 'crear'),
  validateBody(conOperacionCliente(crearProveedorSchema)),
  async (req, res) => {
    const envio = await ejecutarOperacion(res, TIPO_OPERACION.proveedorCrear, req.body, req.user!.sub, () => crearProveedor(req.body));
    if (!envio) return;
    const { resultado: result, repetida } = envio;
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'proveedor_creado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      proveedorId: result.proveedor.id,
    });
    res.status(repetida ? 200 : 201).json(cuerpoConRepetida(result, repetida));
  }
);

router.patch(
  '/:id',
  requirePermiso('proveedores', 'editar'),
  validateBody(actualizarProveedorSchema),
  async (req, res) => {
    const id = String(req.params.id);
    if (await cambioReportesNoPermitido('proveedores', id, req.user!.rol, req.body.telegramReportesActivos)) {
      res.status(403).json({ error: MENSAJE_SOLO_ADMIN_REPORTES_TELEGRAM });
      return;
    }
    const result = await actualizarProveedor(id, req.body);
    if ('error' in result) {
      const status = 'pendiente' in result ? 409 : result.error.includes('no encontrado') ? 404 : 400;
      res.status(status).json(result);
      return;
    }
    logger.info({
      evento: 'proveedor_actualizado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      proveedorId: id,
    });
    res.json(result);
  }
);

router.post(
  '/:id/telegram/generar-link',
  requirePermiso('proveedores', 'editar'),
  async (req, res) => {
    const id = String(req.params.id);
    const result = await generarLinkTelegram('proveedor', id);
    if ('error' in result) {
      const status = result.error.includes('no encontrado') ? 404 : 400;
      res.status(status).json(result);
      return;
    }
    logger.info({
      evento: 'proveedor_telegram_link_generado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      proveedorId: id,
    });
    res.json(result);
  }
);

router.post('/:id/desactivar', requirePermiso('proveedores', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const ok = await desactivarProveedor(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo desactivar el proveedor.' });
    return;
  }
  logger.info({
    evento: 'proveedor_desactivado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    proveedorId: id,
  });
  res.json({ ok: true });
});

router.post('/:id/reactivar', requirePermiso('proveedores', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const ok = await reactivarProveedor(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo reactivar el proveedor.' });
    return;
  }
  logger.info({
    evento: 'proveedor_reactivado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    proveedorId: id,
  });
  res.json({ ok: true });
});

router.delete('/:id', requirePermiso('proveedores', 'eliminar'), async (req, res) => {
  const id = String(req.params.id);
  const result = await borrarProveedor(id);
  if (!result.ok) {
    res.status(409).json({ error: result.razon });
    return;
  }
  logger.warn({
    evento: 'proveedor_borrado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    proveedorId: id,
  });
  res.json({ ok: true });
});

export default router;
