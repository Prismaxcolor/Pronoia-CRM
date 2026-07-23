import { Router } from 'express';
import { validateBody } from '../middlewares/validate.js';
import { requirePortalAuth } from '../middlewares/require-portal-auth.js';
import { portalLoginLimiter } from '../middlewares/rate-limit.js';
import { portalLoginSchema, portalVerificarSchema } from '../schemas/portal.js';
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

export default router;
