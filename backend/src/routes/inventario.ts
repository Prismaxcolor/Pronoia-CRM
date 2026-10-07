import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
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
import { pantallaQuerySchema } from '../schemas/inventario-pantalla.js';
import {
  obtenerAlertasPantalla,
  obtenerCategoriasPantalla,
  obtenerDetallePantalla,
  type OpcionesPantalla,
} from '../services/inventario-pantalla-service.js';
import { composicionLoteQuerySchema, loteIdSchema } from '../schemas/lote-composicion.js';
import { obtenerComposicionLote } from '../services/lote-composicion-pantalla.js';
import { actualizarCostosSchema } from '../schemas/inventario-costos.js';
import { actualizarCostosReferencia, obtenerCostosInventario } from '../services/inventario-costos-service.js';
import { vaciarDesechos } from '../services/vaciar-desechos-service.js';
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
// trae valorOculto: true y ni siquiera se consultan los costos. `?sinValor=1` fuerza ese mismo modo sin dinero aunque
// el usuario tenga facturacion:ver (lo usa /inventario, que solo muestra kilos); nunca amplía permisos.
router.get('/resumen', requirePermiso('productos', 'ver'), async (req, res) => {
  const query = resumenQuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.issues[0]?.message ?? 'Parámetros inválidos.' });
    return;
  }
  try {
    const { sinValor, ...filtros } = query.data;
    const incluirValor = !sinValor && reqTienePermiso(req, 'facturacion', 'ver');
    res.json({ resumen: await obtenerResumenInventario({ ...filtros, incluirValor }) });
  } catch (err) {
    logger.error({ evento: 'resumen_inventario_error', ip: clienteIp(req), userId: req.user!.sub, motivo: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'No se pudo calcular el resumen del inventario.' });
  }
});

// Pantalla nueva de inventario (solo lectura): detalle, tarjetas y alertas. Permiso productos:ver para los
// kilos; costos, precios y valores SOLO con facturacion:ver (sin él, valorOculto: true y ni se consultan los costos).
// Comparten una caché corta; ver services/inventario-pantalla-service.ts.
function rutaPantalla(evento: string, clave: string, servicio: (opts: OpcionesPantalla) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    const query = pantallaQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.issues[0]?.message ?? 'Parámetros inválidos.' });
      return;
    }
    try {
      const { sinValor, ...filtros } = query.data;
      const incluirValor = !sinValor && reqTienePermiso(req, 'facturacion', 'ver');
      res.json({ [clave]: await servicio({ ...filtros, incluirValor }) });
    } catch (err) {
      logger.error({ evento, ip: clienteIp(req), userId: req.user!.sub, motivo: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'No se pudo calcular esta parte del inventario. Intenta de nuevo.' });
    }
  };
}

router.get('/pantalla/detalle', requirePermiso('productos', 'ver'), rutaPantalla('pantalla_detalle_error', 'detalle', obtenerDetallePantalla));
router.get('/pantalla/categorias', requirePermiso('productos', 'ver'), rutaPantalla('pantalla_categorias_error', 'categorias', obtenerCategoriasPantalla));
router.get('/pantalla/alertas', requirePermiso('productos', 'ver'), rutaPantalla('pantalla_alertas_error', 'alertas', obtenerAlertasPantalla));

// Composición de un lote por producto (solo kilos, sin dinero): stock actual y comprado en el periodo.
router.get('/pantalla/lotes/:loteId/composicion', requirePermiso('productos', 'ver'), async (req, res) => {
  const loteId = loteIdSchema.safeParse(req.params.loteId);
  const query = composicionLoteQuerySchema.safeParse(req.query);
  if (!loteId.success || !query.success) {
    const causa = !loteId.success ? loteId.error : query.error!;
    res.status(400).json({ error: causa.issues[0]?.message ?? 'Parámetros inválidos.' });
    return;
  }
  try {
    const composicion = await obtenerComposicionLote(loteId.data, query.data);
    if (!composicion) {
      res.status(404).json({ error: 'Lote no encontrado.' });
      return;
    }
    res.json({ composicion });
  } catch (err) {
    logger.error({ evento: 'pantalla_composicion_lote_error', ip: clienteIp(req), userId: req.user!.sub, motivo: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'No se pudo calcular la composición del lote. Intenta de nuevo.' });
  }
});

// Costos de referencia por producto (USD/kg). Leer: facturacion:ver; guardar: facturacion:editar y también ver (la respuesta trae todos los costos). Sin esos permisos
// no se consulta ni se devuelve ningún costo. PUT: máx. 500 productos, guardado atómico, vacía las cachés de la pantalla.
router.get('/costos', requirePermiso('facturacion', 'ver'), async (req, res) => {
  try {
    res.json({ costos: await obtenerCostosInventario() });
  } catch (err) {
    logger.error({ evento: 'costos_inventario_error', ip: clienteIp(req), userId: req.user!.sub, motivo: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'No se pudieron calcular los costos del inventario. Intenta de nuevo.' });
  }
});

router.put('/costos', requirePermiso('facturacion', 'ver'), requirePermiso('facturacion', 'editar'), validateBody(actualizarCostosSchema), async (req, res) => {
  try {
    const result = await actualizarCostosReferencia(req.body, { userId: req.user!.sub, email: req.user!.email });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ costos: result.costos, ...(result.advertencia ? { advertencia: result.advertencia } : {}) });
  } catch (err) {
    logger.error({ evento: 'costos_inventario_guardar_error', ip: clienteIp(req), userId: req.user!.sub, motivo: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'No se pudieron guardar los costos. Intenta de nuevo.' });
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

// Vaciar DESECHOS: deja ese (y solo ese) producto en 0 kg. Es un ajuste de inventario: exige toma_fisica:editar.
router.post('/desechos/:productoId/vaciar', requirePermiso('toma_fisica', 'editar'), async (req, res) => {
  const productoId = z.string().uuid().safeParse(req.params.productoId);
  if (!productoId.success) {
    res.status(400).json({ error: 'El id del producto no es válido.' });
    return;
  }
  const r = await vaciarDesechos(productoId.data, req.user!.sub);
  if (!r.ok) {
    res.status(r.status).json({ error: r.error });
    return;
  }
  logger.info({ evento: 'desechos_vaciados_api', ip: clienteIp(req), userId: req.user!.sub, kgVaciados: r.kgVaciados });
  res.json({ kgVaciados: r.kgVaciados, almacenes: r.almacenes });
});

export default router;
