import { Router, type Request, type Response } from 'express';
import type { ZodType } from 'zod';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { validarUuidParam } from '../middlewares/validate-uuid-param.js';
import { exigirAccesoBancas } from '../middlewares/exigir-acceso-bancas.js';
import {
  actualizarCategoriaSchema, asignarCategoriaSchema, crearCategoriaSchema, filtroReporteCategoriasSchema, filtroReporteCuentaSchema,
} from '../schemas/categorias-wallet.js';
import {
  actualizarCategoria, asignarCategoriaMovimiento, crearCategoria, listarCategorias, type FalloCategoria,
} from '../services/categoria-service.js';
import { obtenerReporteCategorias, obtenerReporteCuenta } from '../services/reporte-wallet-service.js';
import { bancasPermitidas, idsBancasDeMovimiento } from '../services/banca-acceso-service.js';
import { logger, clienteIp } from '../utils/logger.js';

/**
 * Categorías y subcategorías del Wallet, reporte por categorías y reporte de una cuenta.
 * Se monta bajo /api/cochinito y reutiliza los permisos del módulo (ver / crear / editar).
 */
const router = Router();

router.use(requireAuth);

function responderFallo(res: Response, f: FalloCategoria): void {
  res.status(f.codigo).json({ error: f.error });
}

/** Valida los parámetros de consulta; responde 400 y devuelve null si son inválidos. */
function leerFiltro<T>(schema: ZodType<T>, req: Request, res: Response): T | null {
  const r = schema.safeParse(req.query);
  if (!r.success) {
    res.status(400).json({ error: r.error.issues[0]?.message ?? 'Filtro inválido.' });
    return null;
  }
  return r.data;
}

router.get('/categorias', requirePermiso('cochinito', 'ver'), async (_req, res) => {
  const r = await listarCategorias();
  if ('error' in r) return responderFallo(res, r);
  res.json(r);
});

router.post('/categorias', requirePermiso('cochinito', 'crear'), validateBody(crearCategoriaSchema), async (req, res) => {
  const r = await crearCategoria(req.body, req.user!.sub);
  if ('error' in r) return responderFallo(res, r);
  logger.info({ evento: 'categoria_wallet_creada', ip: clienteIp(req), userId: req.user!.sub, categoriaId: r.categoria.id });
  res.status(201).json(r);
});

// Editar, y también archivar / restaurar (activo: false / true): las categorías nunca se borran.
router.patch(
  '/categorias/:id',
  validarUuidParam('id'),
  requirePermiso('cochinito', 'editar'),
  validateBody(actualizarCategoriaSchema),
  async (req, res) => {
    const id = String(req.params.id);
    const r = await actualizarCategoria(id, req.body);
    if ('error' in r) return responderFallo(res, r);
    logger.info({ evento: 'categoria_wallet_actualizada', ip: clienteIp(req), userId: req.user!.sub, categoriaId: id });
    res.json(r);
  },
);

// Cambiar solo la categoría de un movimiento manual: no toca montos ni saldos, así que no pide llave de edición.
router.patch(
  '/movimientos/:id/categoria',
  validarUuidParam('id'),
  requirePermiso('cochinito', 'editar'),
  validateBody(asignarCategoriaSchema),
  exigirAccesoBancas(req => idsBancasDeMovimiento(String(req.params.id))),
  async (req, res) => {
    const id = String(req.params.id);
    const r = await asignarCategoriaMovimiento(id, req.body.categoriaId);
    if ('error' in r) return responderFallo(res, r);
    logger.info({ evento: 'movimiento_categoria_cambiada', ip: clienteIp(req), userId: req.user!.sub, movimientoId: id, categoriaId: req.body.categoriaId });
    res.json({ ok: true, categoriaId: req.body.categoriaId });
  },
);

router.get('/reportes/cuenta', requirePermiso('cochinito', 'ver'), async (req, res) => {
  const filtro = leerFiltro(filtroReporteCuentaSchema, req, res);
  if (!filtro) return;
  const permitidas = await bancasPermitidas(req.user!.sub, req.user!.rol);
  const r = await obtenerReporteCuenta(filtro, permitidas);
  if ('error' in r) return responderFallo(res, r);
  res.json(r.reporte);
});

router.get('/reportes/categorias', requirePermiso('cochinito', 'ver'), async (req, res) => {
  const filtro = leerFiltro(filtroReporteCategoriasSchema, req, res);
  if (!filtro) return;
  const permitidas = await bancasPermitidas(req.user!.sub, req.user!.rol);
  const r = await obtenerReporteCategorias(filtro, permitidas);
  if ('error' in r) return responderFallo(res, r);
  res.json(r.reporte);
});

export default router;
