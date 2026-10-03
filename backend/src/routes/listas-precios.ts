import { Router } from 'express';
import {
  listarListas,
  obtenerListaDetalle,
  crearLista,
  actualizarLista,
  eliminarLista,
  upsertPrecioEnLista,
  eliminarPrecio,
  listasParaProducto,
} from '../services/lista-precios-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import {
  crearListaSchema,
  actualizarListaSchema,
  upsertPrecioSchema,
} from '../schemas/listas-precios.js';
import { logger, clienteIp } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

// Listas de precios = configuración del catálogo → permiso 'listas_precios'. Hay
// listas de compra (a proveedores) y de venta (a clientes), ver Bloque 32.

router.get('/', requirePermiso('listas_precios', 'ver'), async (req, res) => {
  const tipo = req.query.tipo === 'compra' || req.query.tipo === 'venta' ? req.query.tipo : undefined;
  const listas = await listarListas(tipo);
  res.json({ listas });
});

// IMPORTANTE: declarar antes de '/:id' para que no lo capture la ruta dinámica.
router.get('/para-producto/:productoId', requirePermiso('listas_precios', 'ver'), async (req, res) => {
  const tipo = req.query.tipo === 'venta' ? 'venta' : 'compra';
  const listas = await listasParaProducto(String(req.params.productoId), tipo);
  res.json({ listas });
});

router.post(
  '/',
  requirePermiso('listas_precios', 'crear'),
  validateBody(crearListaSchema),
  async (req, res) => {
    const result = await crearLista(req.body);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    logger.info({
      evento: 'lista_precios_creada',
      ip: clienteIp(req),
      userId: req.user!.sub,
      listaId: result.lista.id,
    });
    res.status(201).json(result);
  }
);

router.get('/:id', requirePermiso('listas_precios', 'ver'), async (req, res) => {
  const detalle = await obtenerListaDetalle(String(req.params.id));
  if (!detalle) {
    res.status(404).json({ error: 'Lista no encontrada.' });
    return;
  }
  res.json(detalle);
});

router.patch(
  '/:id',
  requirePermiso('listas_precios', 'editar'),
  validateBody(actualizarListaSchema),
  async (req, res) => {
    const id = String(req.params.id);
    const result = await actualizarLista(id, req.body);
    if ('error' in result) {
      const status = result.error.includes('no encontrada') ? 404 : 400;
      res.status(status).json(result);
      return;
    }
    logger.info({
      evento: 'lista_precios_actualizada',
      ip: clienteIp(req),
      userId: req.user!.sub,
      listaId: id,
    });
    res.json(result);
  }
);

router.delete('/:id', requirePermiso('listas_precios', 'eliminar'), async (req, res) => {
  const id = String(req.params.id);
  const result = await eliminarLista(id);
  if (!result.ok) {
    res.status(409).json({ error: result.razon });
    return;
  }
  logger.warn({
    evento: 'lista_precios_borrada',
    ip: clienteIp(req),
    userId: req.user!.sub,
    listaId: id,
  });
  res.json({ ok: true });
});

// ---- precios (líneas de detalle) -------------------------------------------

router.put(
  '/:id/precios',
  requirePermiso('listas_precios', 'editar'),
  validateBody(upsertPrecioSchema),
  async (req, res) => {
    const listaId = String(req.params.id);
    const result = await upsertPrecioEnLista(listaId, req.body);
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  }
);

router.delete(
  '/:id/precios/:productoId',
  requirePermiso('listas_precios', 'editar'),
  async (req, res) => {
    const ok = await eliminarPrecio(String(req.params.id), String(req.params.productoId));
    if (!ok) {
      res.status(500).json({ error: 'No se pudo eliminar el precio.' });
      return;
    }
    res.json({ ok: true });
  }
);

export default router;
