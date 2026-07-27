import { Router } from 'express';
import { validateBody } from '../middlewares/validate.js';
import { requirePortalAuth } from '../middlewares/require-portal-auth.js';
import { portalLoginLimiter } from '../middlewares/rate-limit.js';
import { portalLoginSchema, portalVerificarSchema } from '../schemas/portal.js';
import { crearCitaSchema, FECHA_RE } from '../schemas/citas.js';
import { obtenerDisponibilidad, crearCita, listarCitasEntidad, cancelarCitaPropia } from '../services/cita-despacho-service.js';
import {
  solicitarLogin,
  verificarLoginToken,
  firmarSesionPortal,
  PORTAL_COOKIE_NAME,
  portalCookieOptions,
} from '../services/portal-auth-service.js';
import { obtenerDocumentosPortal } from '../services/portal-documentos-service.js';
import { TABLA_ENTIDAD } from '../services/telegram-link-service.js';
import { obtenerFactura } from '../services/factura-service.js';
import { obtenerTicket } from '../services/ticket-pesaje-service.js';
import { generarFacturaPdf, generarTicketPdf, nombreArchivoFactura, nombreArchivoTicket } from '../services/document-generator.js';
import { obtenerEstadoCuenta } from '../services/estado-cuenta-service.js';
import { listarListas, obtenerListaDetalle } from '../services/lista-precios-service.js';
import { listarGuiasEntidad } from '../services/guia-corpoez-service.js';
import { supabaseAdmin } from '../config/supabase.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.post('/login', portalLoginLimiter, validateBody(portalLoginSchema), async (req, res) => {
  await solicitarLogin(req.body.identificador);
  // Respuesta siempre genérica — no revela si el identificador existe ni si está
  // vinculado a Telegram (protección contra enumeración).
  res.json({
    ok: true,
    mensaje: 'Si tus datos están registrados y vinculados a Telegram, vas a recibir el link de acceso en breve.',
  });
});

router.post('/verificar', validateBody(portalVerificarSchema), async (req, res) => {
  const resultado = await verificarLoginToken(req.body.token);
  if (!resultado) {
    res.status(400).json({ error: 'Este link ya no es válido. Pide uno nuevo desde el portal.' });
    return;
  }

  const token = firmarSesionPortal(resultado);
  res.cookie(PORTAL_COOKIE_NAME, token, portalCookieOptions());
  logger.info({
    evento: 'portal_login_exitoso',
    ip: clienteIp(req),
    entidadTipo: resultado.entidadTipo,
    entidadId: resultado.entidadId,
  });
  res.json({ ok: true });
});

router.post('/logout', (_req, res) => {
  res.clearCookie(PORTAL_COOKIE_NAME, portalCookieOptions());
  res.json({ ok: true });
});

router.get('/me', requirePortalAuth, async (req, res) => {
  const { entidadTipo, entidadId } = req.portalUser!;
  const { data } = await supabaseAdmin
    .from(TABLA_ENTIDAD[entidadTipo])
    .select('id, nombre')
    .eq('id', entidadId)
    .maybeSingle();

  if (!data) {
    res.status(404).json({ error: 'No encontrado.' });
    return;
  }

  res.json({ entidadTipo, entidadId, nombre: data.nombre });
});

router.get('/documentos', requirePortalAuth, async (req, res) => {
  const { entidadTipo, entidadId } = req.portalUser!;
  const documentos = await obtenerDocumentosPortal(entidadTipo, entidadId);
  res.json(documentos);
});

// El PDF no se guarda con un link fijo — se genera al vuelo, siempre igual al que ya
// se ve en el sistema interno. Cada endpoint valida que el documento sea del propio
// proveedor/cliente autenticado antes de generar nada (nunca confiar solo en el id
// que viene en la URL — ver deuda de RLS documentada por el dev).
router.get('/documentos/facturas/:id/pdf', requirePortalAuth, async (req, res) => {
  const { entidadTipo, entidadId } = req.portalUser!;
  const tipo = entidadTipo === 'proveedor' ? 'compra' : 'venta';
  const factura = await obtenerFactura(tipo, String(req.params.id));

  if (!factura || factura.entidadId !== entidadId) {
    res.status(404).json({ error: 'Factura no encontrada.' });
    return;
  }

  const buffer = generarFacturaPdf(factura);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nombreArchivoFactura(factura)}"`);
  res.send(buffer);
});

router.get('/documentos/tickets/:id/pdf', requirePortalAuth, async (req, res) => {
  const { entidadTipo, entidadId } = req.portalUser!;
  const ticket = await obtenerTicket(String(req.params.id));

  if (!ticket || ticket.entidadId !== entidadId) {
    res.status(404).json({ error: 'Ticket no encontrado.' });
    return;
  }

  const { data } = await supabaseAdmin
    .from(TABLA_ENTIDAD[entidadTipo])
    .select('nombre')
    .eq('id', entidadId)
    .maybeSingle();

  const buffer = generarTicketPdf(ticket, data?.nombre ?? '—');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nombreArchivoTicket(ticket)}"`);
  res.send(buffer);
});

router.get('/estado-cuenta', requirePortalAuth, async (req, res) => {
  const { entidadTipo, entidadId } = req.portalUser!;
  const estado = await obtenerEstadoCuenta(entidadTipo, entidadId);
  if (!estado) {
    res.status(404).json({ error: 'No encontrado.' });
    return;
  }
  res.json(estado);
});

// Listas de precios activas — no hay una lista "asignada" a cada proveedor/cliente
// en el modelo de datos actual (facturas_compra/venta eligen la lista al momento de
// facturar), así que se muestran todas las vigentes por igual.
router.get('/precios', requirePortalAuth, async (_req, res) => {
  const listas = await listarListas();
  const activas = listas.filter(l => l.activo);
  const detalles = await Promise.all(activas.map(l => obtenerListaDetalle(l.id)));
  res.json({ listas: detalles.filter((d): d is NonNullable<typeof d> => d !== null) });
});

router.get('/agendar/disponibilidad', requirePortalAuth, async (req, res) => {
  const fecha = String(req.query.fecha ?? '');
  if (!FECHA_RE.test(fecha)) {
    res.status(400).json({ error: 'Fecha inválida.' });
    return;
  }
  const horarios = await obtenerDisponibilidad(fecha);
  res.json({ horarios });
});

router.get('/agendar', requirePortalAuth, async (req, res) => {
  const { entidadTipo, entidadId } = req.portalUser!;
  const citas = await listarCitasEntidad(entidadTipo, entidadId);
  res.json({ citas });
});

router.post('/agendar', requirePortalAuth, validateBody(crearCitaSchema), async (req, res) => {
  const { entidadTipo, entidadId } = req.portalUser!;
  const resultado = await crearCita(entidadTipo, entidadId, req.body);
  if ('error' in resultado) {
    res.status(409).json(resultado);
    return;
  }
  res.status(201).json(resultado);
});

router.post('/agendar/:id/cancelar', requirePortalAuth, async (req, res) => {
  const { entidadTipo, entidadId } = req.portalUser!;
  const cita = await cancelarCitaPropia(entidadTipo, entidadId, String(req.params.id));
  if (!cita) {
    res.status(404).json({ error: 'La cita no existe o ya no se puede cancelar.' });
    return;
  }
  res.json({ cita });
});

router.get('/guias', requirePortalAuth, async (req, res) => {
  const { entidadTipo, entidadId } = req.portalUser!;
  const guias = await listarGuiasEntidad(entidadTipo, entidadId);
  res.json({ guias });
});

export default router;
