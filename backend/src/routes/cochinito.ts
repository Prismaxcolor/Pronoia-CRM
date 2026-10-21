import { Router } from 'express';
import {
  listarBancas,
  listarMovimientos,
  crearBanca,
  actualizarBanca,
  archivarBanca,
  desarchivarBanca,
  obtenerDetalleMovimiento,
  leerTelegramChatIdBanca,
} from '../services/banca-service.js';
import { comisionBancariaDisponible, registrarMovimiento } from '../services/movimiento-comision-service.js';
import { MINIMO_COMISION_BANCARIA_BS, TASA_COMISION_BANCARIA } from '../utils/comision-bancaria.js';
import { requireAuth, requirePermiso, reqTienePermiso } from '../middlewares/require-auth.js';
import { requirePermisoOLlave } from '../middlewares/permiso-o-llave.js';
import { cargarPermisosSiFaltan } from '../middlewares/cargar-permisos.js';
import { cuerpoConRepetida, ejecutarOperacion, TIPO_OPERACION } from '../services/operaciones-idempotentes-cola.js';
import { anularMovimientoBanca, editarMovimientoBanca } from '../services/movimiento-edicion-service.js';
import { anularTransaccionSchema, editarMovimientoSchema, type EditarMovimientoInput } from '../schemas/transacciones-editar.js';
import { validarUuidParam } from '../middlewares/validate-uuid-param.js';
import { validateBody } from '../middlewares/validate.js';
import { crearBancaSchema, actualizarBancaSchema, crearMovimientoSchema } from '../schemas/cochinito.js';
import { logger, clienteIp } from '../utils/logger.js';
import { aplicarCategoriaSiFalta, validarCategoriaDeMovimiento } from '../services/categoria-service.js';
import { cambioReportesNoPermitido } from '../services/grupo-silencio-service.js';
import { exigirAccesoBancas } from '../middlewares/exigir-acceso-bancas.js';
import { accesoBancas, bancasPermitidas, concederBancaAUsuario, idsBancasDeMovimiento } from '../services/banca-acceso-service.js';
import { anotarPuedeEditar, bancaPermitida, filtrarBancas, enmascararDetalleMovimiento, filtrarMovimientos, enmascararMovimientosPorBanca, puedeCambiarTelegramBanca, puedeCambiarReportesTelegram, MENSAJE_SIN_ACCESO_BANCA, MENSAJE_SOLO_ADMIN_TELEGRAM, MENSAJE_SOLO_ADMIN_REPORTES_TELEGRAM } from '../utils/banca-acceso.js';

const router = Router();

router.use(requireAuth);

router.get('/bancas', requirePermiso('cochinito', 'ver'), async (req, res) => {
  const incluirArchivadas = req.query.incluirArchivadas === 'true';
  const acceso = await accesoBancas(req.user!.sub, req.user!.rol);
  const bancas = anotarPuedeEditar(filtrarBancas(await listarBancas({ incluirArchivadas }), acceso.ver), acceso.editar);
  res.json({ bancas });
});

router.post(
  '/bancas',
  requirePermiso('cochinito', 'crear'),
  validateBody(crearBancaSchema),
  async (req, res) => {
    if (req.body.telegramChatId && !puedeCambiarTelegramBanca(req.user!.rol)) {
      res.status(403).json({ error: MENSAJE_SOLO_ADMIN_TELEGRAM });
      return;
    }
    // Crear con los avisos apagados es cambiar el valor por defecto (true): solo superadmin.
    if (req.body.telegramReportesActivos === false && !puedeCambiarReportesTelegram(req.user!.rol)) {
      res.status(403).json({ error: MENSAJE_SOLO_ADMIN_REPORTES_TELEGRAM });
      return;
    }
    const result = await crearBanca(req.body);
    if ('error' in result) {
      res.status(result.pendiente ? 409 : 400).json({ error: result.error });
      return;
    }
    // Quien crea una banca debe poder usarla aunque no sea superadmin (el superadmin ve todas igual).
    const concedida = await concederBancaAUsuario(req.user!.sub, result.banca.id);
    if ('error' in concedida) {
      logger.error({ evento: 'banca_acceso_creador_fallido', userId: req.user!.sub, bancaId: result.banca.id, mensaje: concedida.error });
      if (!puedeCambiarTelegramBanca(req.user!.rol)) {
        // Sin acceso la cuenta quedaría invisible para quien la creó: se archiva (saldo 0) y se avisa.
        await archivarBanca(result.banca.id);
        res.status(500).json({ error: 'No se pudo asignarte acceso a la cuenta nueva; no se creó. Inténtalo de nuevo.' });
        return;
      }
    }
    logger.info({
      evento: 'banca_creada',
      ip: clienteIp(req),
      userId: req.user!.sub,
      bancaId: result.banca.id,
    });
    res.status(201).json(result);
  }
);

router.patch(
  '/bancas/:id',
  requirePermiso('cochinito', 'editar'),
  validateBody(actualizarBancaSchema),
  exigirAccesoBancas(async req => [String(req.params.id)]),
  async (req, res) => {
    const id = String(req.params.id);
    const nuevoChat: string | null | undefined = req.body.telegramChatId;
    const anteriorChat = nuevoChat === undefined ? null : await leerTelegramChatIdBanca(id);
    const cambiaChat = nuevoChat !== undefined && nuevoChat !== anteriorChat;
    if (cambiaChat && !puedeCambiarTelegramBanca(req.user!.rol)) {
      res.status(403).json({ error: MENSAJE_SOLO_ADMIN_TELEGRAM });
      return;
    }
    const nuevoReportes: boolean | undefined = req.body.telegramReportesActivos;
    if (await cambioReportesNoPermitido('bancas', id, req.user!.rol, nuevoReportes)) {
      res.status(403).json({ error: MENSAJE_SOLO_ADMIN_REPORTES_TELEGRAM });
      return;
    }
    const result = await actualizarBanca(id, req.body);
    if ('error' in result) {
      const status = result.pendiente ? 409 : result.error.includes('no encontrada') ? 404 : 400;
      res.status(status).json({ error: result.error });
      return;
    }
    logger.info({
      evento: 'banca_actualizada',
      ip: clienteIp(req),
      userId: req.user!.sub,
      bancaId: id,
    });
    if (nuevoReportes !== undefined) {
      logger.info({ evento: 'banca_telegram_reportes_modificado', userId: req.user!.sub, bancaId: id, activos: nuevoReportes });
    }
    if (cambiaChat) {
      logger.info({ evento: 'banca_telegram_chat_modificado', userId: req.user!.sub, bancaId: id, anterior: anteriorChat, nuevo: nuevoChat });
    }
    res.json(result);
  }
);

router.post('/bancas/:id/archivar', requirePermiso('cochinito', 'editar'), exigirAccesoBancas(async req => [String(req.params.id)]), async (req, res) => {
  const id = String(req.params.id);
  const result = await archivarBanca(id);
  if (!result.ok) {
    res.status(409).json({ error: result.razon });
    return;
  }
  logger.info({
    evento: 'banca_archivada',
    ip: clienteIp(req),
    userId: req.user!.sub,
    bancaId: id,
  });
  res.json({ ok: true });
});

router.post('/bancas/:id/desarchivar', requirePermiso('cochinito', 'editar'), exigirAccesoBancas(async req => [String(req.params.id)]), async (req, res) => {
  const id = String(req.params.id);
  const ok = await desarchivarBanca(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo desarchivar la banca.' });
    return;
  }
  logger.info({
    evento: 'banca_desarchivada',
    ip: clienteIp(req),
    userId: req.user!.sub,
    bancaId: id,
  });
  res.json({ ok: true });
});

router.get('/movimientos', requirePermiso('cochinito', 'ver'), async (req, res) => {
  const permitidas = await bancasPermitidas(req.user!.sub, req.user!.rol);
  // Quien ve solo una punta de una transferencia no ve referencia, comprobantes ni descripción (podrían nombrar la otra cuenta).
  const movimientos = enmascararMovimientosPorBanca(filtrarMovimientos(await listarMovimientos(), permitidas), permitidas);
  res.json({ movimientos });
});

// ¿Se ofrece la comisión bancaria? Solo si la migración está aplicada. Incluye la regla para el formulario.
router.get('/comision-bancaria', requirePermiso('cochinito', 'ver'), async (_req, res) => {
  res.json({ disponible: await comisionBancariaDisponible(), tasa: TASA_COMISION_BANCARIA, minimoBs: MINIMO_COMISION_BANCARIA_BS });
});

// Detalle de un movimiento con los nombres resueltos. Los nombres de proveedor y cliente solo se
// incluyen si quien consulta puede verlos (mismo criterio que la tabla).
router.get('/movimientos/:id', validarUuidParam('id'), requirePermiso('cochinito', 'ver'), async (req, res) => {
  const detalle = await obtenerDetalleMovimiento(String(req.params.id), {
    verProveedores: reqTienePermiso(req, 'proveedores', 'ver'),
    verClientes: reqTienePermiso(req, 'clientes', 'ver'),
    verCambistas: reqTienePermiso(req, 'mesa_cambio', 'ver'),
  });
  if (!detalle) {
    res.status(404).json({ error: 'Movimiento no encontrado.' });
    return;
  }
  const { bancaOrigenId, bancaDestinoId } = detalle.movimiento;
  const permitidas = await bancasPermitidas(req.user!.sub, req.user!.rol);
  const visible = bancaPermitida(permitidas, bancaOrigenId) || (bancaDestinoId !== null && bancaPermitida(permitidas, bancaDestinoId));
  if (!visible) {
    res.status(403).json({ error: MENSAJE_SIN_ACCESO_BANCA });
    return;
  }
  res.json(enmascararDetalleMovimiento(detalle, permitidas));
});

router.post(
  '/movimientos',
  requirePermiso('cochinito', 'crear'),
  validateBody(crearMovimientoSchema),
  exigirAccesoBancas(),
  async (req, res) => {
    const categoriaInvalida = await validarCategoriaDeMovimiento(req.body.categoriaId, req.body.tipo);
    if (categoriaInvalida) {
      res.status(categoriaInvalida.codigo).json({ error: categoriaInvalida.error });
      return;
    }
    // Con clientRequestId un doble clic o reintento no registra el movimiento (ni su comisión) dos veces.
    const envio = await ejecutarOperacion(res, TIPO_OPERACION.walletMovimientoCrear, req.body, req.user!.sub, async () => {
      const registrado = await registrarMovimiento(req.body, req.user!.sub);
      if ('error' in registrado) return registrado;
      // La ruta con comisión crea el movimiento por una RPC que no lleva la categoría: se la aplica aquí.
      return aplicarCategoriaSiFalta(registrado, req.body.categoriaId);
    });
    if (!envio) return;
    const { resultado: result, repetida } = envio;
    if ('error' in result) {
      res.status(result.codigo).json({ error: result.error });
      return;
    }
    logger.info({
      evento: 'movimiento_creado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      movimientoId: result.movimiento.id,
      tipo: result.movimiento.tipo,
      repetida,
    });
    res.status(repetida ? 200 : 201).json(cuerpoConRepetida(result, repetida));
  }
);

// Editar y anular un movimiento de banca manual con llave de edición, como los tickets.
// Responde con el movimiento actualizado en `movimiento` (lo lee el aviso de Telegram).
router.patch(
  '/movimientos/:id',
  validarUuidParam('id'),
  requirePermisoOLlave('cochinito', 'editar'),
  validateBody(editarMovimientoSchema),
  exigirAccesoBancas(req => idsBancasDeMovimiento(String(req.params.id))),
  async (req, res) => {
    const { llaveEdicion, ...datos } = req.body as EditarMovimientoInput;
    const id = String(req.params.id);
    const result = await editarMovimientoBanca(id, datos, {
      userId: req.user!.sub, email: req.user!.email, rol: req.user!.rol, llave: llaveEdicion,
    });
    if ('error' in result) {
      res.status(result.codigo).json({ error: result.error });
      return;
    }
    logger.info({ evento: 'movimiento_editado', ip: clienteIp(req), userId: req.user!.sub, movimientoId: id });
    res.json(result);
  }
);

router.post(
  '/movimientos/:id/anular',
  validarUuidParam('id'),
  requirePermisoOLlave('cochinito', 'editar'),
  cargarPermisosSiFaltan,
  validateBody(anularTransaccionSchema),
  exigirAccesoBancas(req => idsBancasDeMovimiento(String(req.params.id))),
  async (req, res) => {
    const id = String(req.params.id);
    // Una transferencia con cambista además exige mesa_cambio:ver, igual que completarla (ver transferencia-mesa.ts).
    const result = await anularMovimientoBanca(id, req.body.motivo, {
      userId: req.user!.sub, email: req.user!.email, rol: req.user!.rol, llave: req.body.llaveEdicion,
    }, { puedeMesaCambio: reqTienePermiso(req, 'mesa_cambio', 'ver') });
    if ('error' in result) {
      res.status(result.codigo).json({ error: result.error });
      return;
    }
    logger.info({ evento: 'movimiento_anulado', ip: clienteIp(req), userId: req.user!.sub, movimientoId: id });
    res.json(result);
  }
);

export default router;
