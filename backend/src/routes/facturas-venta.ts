import { Router } from 'express';
import { ejecutarOperacionFinanciera } from '../services/operacion-financiera.js';
import { TIPO_OPERACION, cuerpoConRepetida } from '../services/operaciones-idempotentes-cola.js';
import { listarFacturas, obtenerFactura, crearFactura } from '../services/factura-service.js';
import { resumenNotasVentaONull } from '../services/notas-resumen-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { crearFacturaSchema } from '../schemas/facturas.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermiso('facturacion', 'ver'), async (req, res) => {
  const facturas = await listarFacturas('venta', {
    desde: req.query.desde ? String(req.query.desde) : undefined,
    hasta: req.query.hasta ? String(req.query.hasta) : undefined,
    entidadId: req.query.entidadId ? String(req.query.entidadId) : undefined,
    productoId: req.query.productoId ? String(req.query.productoId) : undefined,
  });
  res.json({ facturas });
});

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const fechaDeConsulta = (v: unknown): string | undefined => (typeof v === 'string' && FECHA_ISO.test(v) ? v : undefined);

// Totales de notas de crédito/débito vigentes de los clientes en el periodo: el indicador "Emitido sin registro de
// cobros" las suma (débito) y resta (crédito) a lo facturado. Debe ir antes de '/:id'.
router.get('/notas-resumen', requirePermiso('facturacion', 'ver'), async (req, res) => {
  const resumen = await resumenNotasVentaONull(fechaDeConsulta(req.query.desde), fechaDeConsulta(req.query.hasta));
  if (!resumen) {
    res.status(503).json({ error: 'No se pudieron calcular las notas del periodo. Intenta de nuevo.' });
    return;
  }
  res.json({ resumen });
});

router.get('/:id', requirePermiso('facturacion', 'ver'), async (req, res) => {
  const factura = await obtenerFactura('venta', String(req.params.id));
  if (!factura) {
    res.status(404).json({ error: 'Factura no encontrada.' });
    return;
  }
  res.json({ factura });
});

router.post(
  '/',
  requirePermiso('facturacion', 'crear'),
  validateBody(crearFacturaSchema),
  async (req, res) => {
    // Con clientRequestId un doble clic o reintento no crea una segunda factura (responde 200 con `repetida`).
    const envio = await ejecutarOperacionFinanciera(res, TIPO_OPERACION.facturaVentaCrear, req.body, req.user!.sub,
      () => crearFactura('venta', req.body, req.user!.sub));
    if (!envio) return;
    const { resultado: result, repetida } = envio;
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'factura_venta_creada',
      ip: clienteIp(req),
      userId: req.user!.sub,
      facturaId: result.factura.id,
      ticketIds: result.factura.ticketIds,
      repetida,
    });
    res.status(repetida ? 200 : 201).json(cuerpoConRepetida(result, repetida));
  }
);

export default router;
