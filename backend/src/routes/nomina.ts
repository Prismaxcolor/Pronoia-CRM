import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { jsonNomina } from '../middlewares/json-por-ruta.js';
import { validateBody } from '../middlewares/validate.js';
import { validarUuidParam } from '../middlewares/validate-uuid-param.js';
import {
  actualizarPrestamoSchema, actualizarTrabajadorSchema, anularSchema, crearPrestamoSchema, crearTrabajadorSchema,
  filtroCategoriaPagoSchema, filtroNominasSchema, filtroPrestamosSchema, filtroSemanaSchema, filtroTrabajadoresSchema,
  guardarNominaSchema, pagarNominaSchema,
} from '../schemas/nomina.js';
import {
  actualizarTrabajador, crearTrabajador, desactivarTrabajador, listarTrabajadores, obtenerTrabajador,
} from '../services/nomina-trabajador-service.js';
import { actualizarPrestamo, anularPrestamo, crearPrestamo, listarPrestamos } from '../services/nomina-prestamo-service.js';
import { listarNominas, obtenerNomina, obtenerNominaSemana } from '../services/nomina-service.js';
import { anularNomina, cerrarNomina, guardarNomina } from '../services/nomina-escritura-service.js';
import { categoriaDePagoNomina, pagarNomina } from '../services/nomina-pago-service.js';
import { exigirAccesoBancas, MENSAJE_ACCESO_NO_VERIFICABLE } from '../middlewares/exigir-acceso-bancas.js';
import { bancasDePagoNomina } from '../services/nomina-pago-lectura.js';
import type { FalloNomina } from '../utils/nomina-errores.js';
import { logger, clienteIp } from '../utils/logger.js';
import type { ZodType } from 'zod';

/**
 * Nómina: datos personales sensibles (cédula, RIF, teléfono, dirección, pago móvil, Binance). Todo exige el permiso de
 * módulo 'nomina'. Los logs llevan SOLO ids y el evento, nunca el cuerpo ni datos del trabajador.
 */
const router = Router();

router.use(requireAuth);
// Cuerpo de hasta 1 mb solo aquí y solo con sesión (el parser global lo omite para /api/nomina).
router.use(jsonNomina);
// Respuestas con datos personales: que ningún navegador ni proxy las guarde.
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

function responderFallo(res: Response, f: FalloNomina): void {
  res.status(f.codigo).json({ error: f.error, ...(f.extra ?? {}) });
}

/** Valida req.query con zod; responde 400 y devuelve null si no cumple. */
function leerConsulta<T>(req: Request, res: Response, schema: ZodType<T>): T | null {
  const r = schema.safeParse(req.query);
  if (r.success) return r.data;
  res.status(400).json({ error: r.error.issues[0]?.message ?? 'Filtro inválido.' });
  return null;
}

function auditar(req: Request, evento: string, ids: Record<string, string>): void {
  logger.info({ evento, ip: clienteIp(req), userId: req.user!.sub, ...ids });
}

// --- Personal ----------------------------------------------------------------------------------------------------

router.get('/trabajadores', requirePermiso('nomina', 'ver'), async (req, res) => {
  const filtro = leerConsulta(req, res, filtroTrabajadoresSchema);
  if (!filtro) return;
  const r = await listarTrabajadores({ tipo: filtro.tipo, incluirInactivos: filtro.incluirInactivos });
  if ('error' in r) return responderFallo(res, r);
  res.json(r);
});

router.post('/trabajadores', requirePermiso('nomina', 'crear'), validateBody(crearTrabajadorSchema), async (req, res) => {
  const r = await crearTrabajador(req.body);
  if ('error' in r) return responderFallo(res, r);
  auditar(req, 'nomina_trabajador_creado', { trabajadorId: r.trabajador.id });
  res.status(201).json(r);
});

router.get('/trabajadores/:id', validarUuidParam('id'), requirePermiso('nomina', 'ver'), async (req, res) => {
  const r = await obtenerTrabajador(String(req.params.id));
  if ('error' in r) return responderFallo(res, r);
  res.json(r);
});

router.patch('/trabajadores/:id', validarUuidParam('id'), requirePermiso('nomina', 'editar'), validateBody(actualizarTrabajadorSchema), async (req, res) => {
  const id = String(req.params.id);
  const r = await actualizarTrabajador(id, req.body);
  if ('error' in r) return responderFallo(res, r);
  auditar(req, 'nomina_trabajador_actualizado', { trabajadorId: id });
  res.json(r);
});

router.post('/trabajadores/:id/desactivar', validarUuidParam('id'), requirePermiso('nomina', 'eliminar'), async (req, res) => {
  const id = String(req.params.id);
  const r = await desactivarTrabajador(id);
  if ('error' in r) return responderFallo(res, r);
  auditar(req, 'nomina_trabajador_desactivado', { trabajadorId: id });
  res.json(r);
});

// --- Préstamos y adelantos -------------------------------------------------------------------------------------------

router.get('/prestamos', requirePermiso('nomina', 'ver'), async (req, res) => {
  const filtro = leerConsulta(req, res, filtroPrestamosSchema);
  if (!filtro) return;
  const r = await listarPrestamos(filtro);
  if ('error' in r) return responderFallo(res, r);
  res.json(r);
});

router.post('/prestamos', requirePermiso('nomina', 'crear'), validateBody(crearPrestamoSchema), async (req, res) => {
  const r = await crearPrestamo(req.body, req.user!.sub);
  if ('error' in r) return responderFallo(res, r);
  auditar(req, 'nomina_prestamo_creado', { prestamoId: r.prestamo.id });
  res.status(201).json(r);
});

router.patch('/prestamos/:id', validarUuidParam('id'), requirePermiso('nomina', 'editar'), validateBody(actualizarPrestamoSchema), async (req, res) => {
  const id = String(req.params.id);
  const r = await actualizarPrestamo(id, req.body);
  if ('error' in r) return responderFallo(res, r);
  auditar(req, 'nomina_prestamo_actualizado', { prestamoId: id });
  res.json(r);
});

router.post('/prestamos/:id/anular', validarUuidParam('id'), requirePermiso('nomina', 'editar'), validateBody(anularSchema), async (req, res) => {
  const id = String(req.params.id);
  const r = await anularPrestamo(id, req.body.motivo, req.user!.sub);
  if ('error' in r) return responderFallo(res, r);
  auditar(req, 'nomina_prestamo_anulado', { prestamoId: id });
  res.json(r);
});

// --- Nómina semanal --------------------------------------------------------------------------------------------------

router.get('/nominas', requirePermiso('nomina', 'ver'), async (req, res) => {
  const filtro = leerConsulta(req, res, filtroNominasSchema);
  if (!filtro) return;
  if (filtro.desde && filtro.hasta && filtro.desde > filtro.hasta) {
    res.status(400).json({ error: 'La fecha "desde" no puede ser posterior a "hasta".' });
    return;
  }
  const r = await listarNominas(filtro);
  if ('error' in r) return responderFallo(res, r);
  res.json(r);
});

// Antes de '/nominas/:id' para que "semana" no se tome como id.
router.get('/nominas/semana', requirePermiso('nomina', 'ver'), async (req, res) => {
  const filtro = leerConsulta(req, res, filtroSemanaSchema);
  if (!filtro) return;
  const r = await obtenerNominaSemana(filtro.tipo, filtro.semana);
  if ('error' in r) return responderFallo(res, r);
  res.json(r);
});

router.get('/nominas/:id', validarUuidParam('id'), requirePermiso('nomina', 'ver'), async (req, res) => {
  const r = await obtenerNomina(String(req.params.id));
  if ('error' in r) return responderFallo(res, r);
  res.json(r);
});

// Crea o edita el borrador de (tipo, semana).
router.post('/nominas', requirePermiso('nomina', 'crear'), validateBody(guardarNominaSchema), async (req, res) => {
  const r = await guardarNomina(req.body, req.user!.sub);
  if ('error' in r) return responderFallo(res, r);
  auditar(req, 'nomina_guardada', { nominaId: r.nomina.id });
  res.json(r);
});

router.post('/nominas/:id/cerrar', validarUuidParam('id'), requirePermiso('nomina', 'editar'), async (req, res) => {
  const id = String(req.params.id);
  const r = await cerrarNomina(id, req.user!.sub);
  if ('error' in r) return responderFallo(res, r);
  if (!r.yaCerrada) auditar(req, 'nomina_cerrada', { nominaId: id });
  res.json(r);
});

// Categoría del Wallet que llevará el egreso del pago de este tipo de personal (null = sin categoría asignada).
router.get('/categoria-pago', requirePermiso('nomina', 'ver'), async (req, res) => {
  const filtro = leerConsulta(req, res, filtroCategoriaPagoSchema);
  if (!filtro) return;
  const r = await categoriaDePagoNomina(filtro.tipo);
  if ('error' in r) return responderFallo(res, r);
  res.json(r);
});

// Mueve dinero: además de editar la nómina exige poder crear movimientos y tener acceso de edición a cada cuenta.
router.post(
  '/nominas/:id/pagar',
  validarUuidParam('id'),
  requirePermiso('nomina', 'editar'),
  requirePermiso('cochinito', 'crear'),
  validateBody(pagarNominaSchema),
  exigirAccesoBancas(),
  async (req, res) => {
    const id = String(req.params.id);
    const r = await pagarNomina(id, req.body, req.user!.sub);
    if ('error' in r) return responderFallo(res, r);
    if (!r.yaPagada) auditar(req, 'nomina_pagada', { nominaId: id });
    res.json(r);
  },
);

/**
 * Anular una nómina pagada desde el Wallet revierte egresos de cuentas: además de nomina.eliminar exige
 * cochinito.editar y acceso de edición a las cuentas del pago. Sin pago no cambia nada. Si no se pueden leer
 * los pagos responde 503 (falla cerrado).
 */
async function exigirWalletSiPagada(req: Request, res: Response, next: NextFunction): Promise<void> {
  let bancas: string[];
  try {
    bancas = await bancasDePagoNomina(String(req.params.id));
  } catch (e) {
    logger.error({ evento: 'nomina_anular_pagos_no_verificables', userId: req.user!.sub, mensaje: e instanceof Error ? e.message : String(e) });
    res.status(503).json({ error: MENSAJE_ACCESO_NO_VERIFICABLE });
    return;
  }
  if (bancas.length === 0) return next();
  await requirePermiso('cochinito', 'editar')(req, res, async () => {
    await exigirAccesoBancas(async () => bancas)(req, res, next);
  });
}

router.post('/nominas/:id/anular', validarUuidParam('id'), requirePermiso('nomina', 'eliminar'), validateBody(anularSchema), exigirWalletSiPagada, async (req, res) => {
  const id = String(req.params.id);
  const r = await anularNomina(id, req.body.motivo, req.user!.sub);
  if ('error' in r) return responderFallo(res, r);
  auditar(req, 'nomina_anulada', { nominaId: id });
  res.json(r);
});

export default router;
