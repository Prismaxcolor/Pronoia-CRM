import { Router } from 'express';
import { obtenerInventario, obtenerInventarioAlmacen } from '../services/inventario-service.js';
import { requireAuth, requirePermiso, requireSuperadmin, reqTienePermiso } from '../middlewares/require-auth.js';
import { parsearAlmacenId } from '../schemas/inventario.js';
import { obtenerResumenInventario } from '../services/inventario-resumen-service.js';
import { invalidarCacheResumen } from '../services/resumen-cache.js';
import {
  actualizarConfiguracionInventario,
  leerConfiguracionInventario,
} from '../services/configuracion-inventario-service.js';
import { actualizarConfiguracionInventarioSchema } from '../schemas/configuracion-inventario.js';
import { resumenQuerySchema } from '../schemas/inventario-resumen.js';
import { validateBody } from '../middlewares/validate.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermiso('productos', 'ver'), async (req, res) => {
  const tipoMaterialId = req.query.tipoMaterialId ? String(req.query.tipoMaterialId) : undefined;
  const productoId = req.query.productoId ? String(req.query.productoId) : undefined;
  const almacen = parsearAlmacenId(req.query.almacenId);
  if (!almacen.ok) {
    res.status(400).json({ error: almacen.error });
    return;
  }
  const almacenId = almacen.almacenId;

  const desde = req.query.desde ? String(req.query.desde) : undefined;
  const hasta = req.query.hasta ? String(req.query.hasta) : undefined;

  // Filtrado por almacén: obtenerInventarioAlmacen() reconstruye los
  // movimientos del almacén (compras, ventas, traslados, transformaciones,
  // ajustes) con las mismas reglas de atribución que stock_almacen() en SQL
  // y soporta un lote repartido entre varios almacenes. desde/hasta acotan
  // los movimientos igual que en la vista global.
  const grupos = almacenId
    ? await obtenerInventarioAlmacen(almacenId, { tipoMaterialId, productoId, desde, hasta })
    : await obtenerInventario({ tipoMaterialId, productoId, desde, hasta });
  res.json({ grupos });
});

// Resumen agregado de solo lectura para la pantalla nueva de inventario (permiso de inventario = 'productos').
// Los kilos los ve cualquiera con productos:ver; los COSTOS de compra y los precios de venta estimados
// solo quien tenga facturacion:ver (superadmin y administración por defecto). Sin ese permiso la respuesta
// trae valorOculto: true y ni siquiera se consultan los costos.
router.get('/resumen', requirePermiso('productos', 'ver'), async (req, res) => {
  const query = resumenQuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.issues[0]?.message ?? 'Parámetros inválidos.' });
    return;
  }
  try {
    const incluirValor = reqTienePermiso(req, 'facturacion', 'ver');
    res.json({ resumen: await obtenerResumenInventario({ ...query.data, incluirValor }) });
  } catch (err) {
    logger.error({ evento: 'resumen_inventario_error', ip: clienteIp(req), userId: req.user!.sub, motivo: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'No se pudo calcular el resumen del inventario.' });
  }
});

// Parámetros no secretos del inventario (meta de contenedor, umbral de merma, alertas).
router.get('/configuracion', requirePermiso('productos', 'ver'), async (_req, res) => {
  res.json({ configuracion: await leerConfiguracionInventario() });
});

// Cambiar la configuración afecta lo que ve todo el equipo: solo superadmin (el nivel más alto que existe).
router.put(
  '/configuracion',
  requirePermiso('productos', 'editar'),
  requireSuperadmin('Solo un superadmin puede cambiar la configuración del inventario.'),
  validateBody(actualizarConfiguracionInventarioSchema),
  async (req, res) => {
    const result = await actualizarConfiguracionInventario(req.body, { userId: req.user!.sub, email: req.user!.email });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    invalidarCacheResumen();
    res.json({ configuracion: result.configuracion, ...(result.advertencia ? { advertencia: result.advertencia } : {}) });
  }
);

export default router;
