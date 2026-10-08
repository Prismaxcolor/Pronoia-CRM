import { Router } from 'express';
import {
  listarProductos,
  crearProducto,
  actualizarProducto,
  desactivarProducto,
  reactivarProducto,
  borrarProducto,
  reordenarProductos,
} from '../services/producto-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { crearProductoSchema, actualizarProductoSchema, reordenarProductosSchema } from '../schemas/productos.js';
import { logger, clienteIp } from '../utils/logger.js';
import { conOperacionCliente, cuerpoConRepetida, ejecutarOperacion, TIPO_OPERACION } from '../services/operaciones-idempotentes-cola.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermiso('productos', 'ver'), async (_req, res) => {
  const productos = await listarProductos();
  res.json({ productos });
});

router.post(
  '/',
  requirePermiso('productos', 'crear'),
  validateBody(conOperacionCliente(crearProductoSchema)),
  async (req, res) => {
    const envio = await ejecutarOperacion(res, TIPO_OPERACION.productoCrear, req.body, req.user!.sub, () => crearProducto(req.body, req.user!.sub));
    if (!envio) return;
    const { resultado: result, repetida } = envio;
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'producto_creado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      productoId: result.producto.id,
      tipo: result.producto.tipo,
      estadoLimpieza: result.producto.estadoLimpieza,
    });
    res.status(repetida ? 200 : 201).json(cuerpoConRepetida(result, repetida));
  }
);

// Declarada antes de '/:id' — si no, Express toma "reordenar" como el :id.
router.patch(
  '/reordenar',
  requirePermiso('productos', 'editar'),
  validateBody(reordenarProductosSchema),
  async (req, res) => {
    const result = await reordenarProductos(req.body.ids);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'productos_reordenados',
      ip: clienteIp(req),
      userId: req.user!.sub,
      cantidad: req.body.ids.length,
    });
    res.json(result);
  }
);

router.patch(
  '/:id',
  requirePermiso('productos', 'editar'),
  validateBody(actualizarProductoSchema),
  async (req, res) => {
    const id = String(req.params.id);
    const result = await actualizarProducto(id, req.body);
    if ('error' in result) {
      const status = result.error.includes('no encontrado') ? 404 : 400;
      res.status(status).json(result);
      return;
    }
    logger.info({
      evento: 'producto_actualizado',
      ip: clienteIp(req),
      userId: req.user!.sub,
      productoId: id,
      // undefined = no se tocó; null = se dejó sin definir
      estadoLimpieza: req.body.estadoLimpieza,
    });
    res.json(result);
  }
);

router.post('/:id/desactivar', requirePermiso('productos', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const ok = await desactivarProducto(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo desactivar el producto.' });
    return;
  }
  logger.info({
    evento: 'producto_desactivado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    productoId: id,
  });
  res.json({ ok: true });
});

router.post('/:id/reactivar', requirePermiso('productos', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const ok = await reactivarProducto(id);
  if (!ok) {
    res.status(500).json({ error: 'No se pudo reactivar el producto.' });
    return;
  }
  logger.info({
    evento: 'producto_reactivado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    productoId: id,
  });
  res.json({ ok: true });
});

router.delete('/:id', requirePermiso('productos', 'eliminar'), async (req, res) => {
  const id = String(req.params.id);
  const result = await borrarProducto(id);
  if (!result.ok) {
    res.status(409).json({ error: result.razon, referencias: result.referencias });
    return;
  }
  logger.warn({
    evento: 'producto_borrado',
    ip: clienteIp(req),
    userId: req.user!.sub,
    productoId: id,
  });
  res.json({ ok: true });
});

export default router;
