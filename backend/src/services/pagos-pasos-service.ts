/** Pasos posteriores al movimiento de dinero de un pago o cobro (categoría, comprobantes, comisión bancaria).
 *
 *  El dinero ya se movió y no se deshace. Lo que falle se anota en `pagos_pasos_pendientes`
 *  (docs/migration_pagos_pasos_pendientes.sql), se reintenta UNA vez de inmediato y, si sigue fallando, lo toma
 *  `reintentarPasosPendientes()` (cron). Mientras quede algo pendiente la respuesta lleva `advertencia`. */
import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import {
  MENSAJE_CATEGORIA_NO_GUARDADA, MENSAJE_COMISION_NO_CARGADA, MENSAJE_COMPROBANTE_NO_GUARDADO,
} from '../utils/mensajes-pago-pasos.js';
import { aplicarCategoriaAMovimientos } from './pago-categoria-service.js';
import {
  aplicarComisionesDePago, reintentarComisionDeBanca, type ComisionPagoCreada, type LineaComisionPago,
} from './pago-comision-service.js';

export type PasoPago = 'categoria' | 'comprobante' | 'comision';

/** Intentos máximos del cron por paso; pasado el tope la fila queda a la vista para repararla a mano. */
export const MAX_INTENTOS_PASO = 5;
/** Filas que revisa el cron por corrida. */
export const LIMITE_REINTENTO_CRON = 50;

const ADVERTENCIA_POR_PASO: Record<PasoPago, string> = {
  categoria: MENSAJE_CATEGORIA_NO_GUARDADA,
  comprobante: MENSAJE_COMPROBANTE_NO_GUARDADO,
  comision: MENSAJE_COMISION_NO_CARGADA,
};

export type DetallePaso =
  | { paso: 'categoria'; movimientoIds: string[]; categoriaId: string }
  | { paso: 'comprobante'; movimientoId: string; comprobantes: string[] }
  | { paso: 'comision'; movimientoIds: string[]; grupoId: string | null; bancaId: string; usuarioId: string };

export interface PasoFallido {
  detalle: DetallePaso;
  grupoId: string | null;
  movimientoId: string | null;
  error: string;
  /** Fila ya anotada en la tabla (la creó la RPC o el cron); si falta, se anota antes de reintentar. */
  pendienteId?: string;
  intentos?: number;
}

export interface EstadoPasos {
  /** Comisiones creadas (en el primer intento o en el reintento). */
  comisiones: ComisionPagoCreada[];
  /** Pasos que siguen sin resolverse tras el reintento inmediato. */
  pendientes: PasoPago[];
  /** Avisos que no tienen reintento propio (p. ej. la categoría de una comisión ya creada). */
  avisos: string[];
}

export function advertenciaDePasos(estado: Pick<EstadoPasos, 'pendientes' | 'avisos'>): string | undefined {
  const textos = [...new Set([...estado.pendientes.map(p => ADVERTENCIA_POR_PASO[p]), ...estado.avisos])];
  return textos.length > 0 ? textos.join(' ') : undefined;
}

type ResultadoPaso = { ok: true; comision?: ComisionPagoCreada } | { ok: false; error: string };

async function repetirPaso(d: DetallePaso): Promise<ResultadoPaso> {
  if (d.paso === 'categoria') {
    const r = await aplicarCategoriaAMovimientos(d.movimientoIds, d.categoriaId);
    return r.advertencia ? { ok: false, error: 'No se pudo aplicar la categoría.' } : { ok: true };
  }
  if (d.paso === 'comprobante') {
    const { error } = await supabaseAdmin.from('movimientos').update({ comprobantes: d.comprobantes }).eq('id', d.movimientoId);
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  return reintentarComisionDeBanca(d.movimientoIds, d.bancaId, d.usuarioId);
}

const textoDe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Anota el paso fallido. Devuelve el id de la fila o null si no se pudo (p. ej. migración sin aplicar). Nunca lanza:
 *  el dinero ya se movió y la respuesta al cliente no debe romperse por esto. */
async function anotarPaso(f: PasoFallido): Promise<string | null> {
  const { paso, ...detalle } = f.detalle;
  try {
    const { data, error } = await supabaseAdmin
      .from('pagos_pasos_pendientes')
      .insert({ grupo_id: f.grupoId, movimiento_id: f.movimientoId, paso, detalle, error: f.error.slice(0, 500) })
      .select('id')
      .single();
    if (!error && data) return (data as { id: string }).id;
    logger.error({ evento: 'pago_paso_no_anotado', paso, grupoId: f.grupoId, faltaTabla: esObjetoInexistente(error), mensaje: error?.message });
  } catch (e) {
    logger.error({ evento: 'pago_paso_no_anotado', paso, grupoId: f.grupoId, mensaje: textoDe(e) });
  }
  return null;
}

async function cerrarPaso(id: string, cambios: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('pagos_pasos_pendientes').update(cambios).eq('id', id);
    if (error) logger.error({ evento: 'pago_paso_no_actualizado', id, mensaje: error.message });
  } catch (e) {
    logger.error({ evento: 'pago_paso_no_actualizado', id, mensaje: textoDe(e) });
  }
}

async function repetirPasoSeguro(d: DetallePaso): Promise<ResultadoPaso> {
  try {
    return await repetirPaso(d);
  } catch (e) {
    return { ok: false, error: textoDe(e) };
  }
}

async function reintentarPaso(f: PasoFallido, id: string | null): Promise<ResultadoPaso> {
  const r = await repetirPasoSeguro(f.detalle);
  const ahora = new Date().toISOString();
  if (id && r.ok) await cerrarPaso(id, { resuelto_at: ahora, ultimo_intento_en: ahora, intentos: (f.intentos ?? 0) + 1, error: null });
  if (id && !r.ok) await cerrarPaso(id, { ultimo_intento_en: ahora, intentos: (f.intentos ?? 0) + 1, error: r.error.slice(0, 500) });
  if (!r.ok) logger.warn({ evento: 'pago_paso_reintento_fallido', paso: f.detalle.paso, grupoId: f.grupoId, mensaje: r.error });
  return r;
}

/** Anota (si falta) y reintenta una vez cada paso fallido. */
export async function repararPasosFallidos(fallidos: readonly PasoFallido[]): Promise<Pick<EstadoPasos, 'comisiones' | 'pendientes'>> {
  const comisiones: ComisionPagoCreada[] = [];
  const pendientes: PasoPago[] = [];
  for (const f of fallidos) {
    const id = f.pendienteId ?? (await anotarPaso(f));
    const r = await reintentarPaso(f, id);
    if (!r.ok) pendientes.push(f.detalle.paso);
    else if (r.comision) comisiones.push(r.comision);
  }
  return { comisiones, pendientes };
}

interface FilaPendiente {
  id: string;
  grupo_id: string | null;
  movimiento_id: string | null;
  paso: PasoPago;
  detalle: Record<string, unknown>;
  intentos: number;
  error: string | null;
}

const esTexto = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const esListaTextos = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');

/** Reconstruye el detalle de una fila guardada; null si no tiene la forma esperada (no se reintenta a ciegas). */
function detalleDeFila(f: FilaPendiente): DetallePaso | null {
  const d = f.detalle;
  if (f.paso === 'categoria' && esListaTextos(d.movimientoIds) && esTexto(d.categoriaId)) {
    return { paso: 'categoria', movimientoIds: d.movimientoIds, categoriaId: d.categoriaId };
  }
  if (f.paso === 'comprobante' && esTexto(d.movimientoId) && esListaTextos(d.comprobantes)) {
    return { paso: 'comprobante', movimientoId: d.movimientoId, comprobantes: d.comprobantes };
  }
  if (f.paso === 'comision' && esListaTextos(d.movimientoIds) && esTexto(d.bancaId) && esTexto(d.usuarioId)) {
    return { paso: 'comision', movimientoIds: d.movimientoIds, grupoId: esTexto(d.grupoId) ? d.grupoId : null, bancaId: d.bancaId, usuarioId: d.usuarioId };
  }
  return null;
}

function fallidoDeFila(f: FilaPendiente): PasoFallido | null {
  const detalle = detalleDeFila(f);
  if (!detalle) {
    logger.error({ evento: 'pago_paso_detalle_invalido', id: f.id, paso: f.paso });
    return null;
  }
  return { detalle, grupoId: f.grupo_id, movimientoId: f.movimiento_id, error: f.error ?? '', pendienteId: f.id, intentos: f.intentos };
}

const COLUMNAS_PENDIENTE = 'id, grupo_id, movimiento_id, paso, detalle, intentos, error';

/** Paso que la RPC `*_completo` anotó como pendiente (id de la fila y tipo). */
export interface PasoAnotado {
  id: string;
  paso: PasoPago;
}

/** Reintento inmediato de las filas que la RPC `*_completo` dejó anotadas dentro de la misma transacción del pago. */
export async function repararPasosAnotados(anotados: readonly PasoAnotado[]): Promise<Pick<EstadoPasos, 'comisiones' | 'pendientes'>> {
  if (anotados.length === 0) return { comisiones: [], pendientes: [] };
  const { data, error } = await supabaseAdmin.from('pagos_pasos_pendientes').select(COLUMNAS_PENDIENTE).in('id', anotados.map(a => a.id));
  if (error || !data) {
    logger.error({ evento: 'pago_pasos_lectura_fallida', mensaje: error?.message });
    return { comisiones: [], pendientes: anotados.map(a => a.paso) };
  }
  const fallidos = (data as FilaPendiente[]).map(fallidoDeFila).filter((f): f is PasoFallido => f !== null);
  return repararPasosFallidos(fallidos);
}

export interface ResumenReintento {
  revisados: number;
  resueltos: number;
  pendientes: number;
}

/**
 * Reintenta los pasos que siguen sin resolver (más antiguos primero, hasta MAX_INTENTOS_PASO intentos cada uno).
 * Pensada para un cron: la ruta es GET/POST /api/pagos/reintentar-pasos-pendientes con
 * `Authorization: Bearer $CRON_SECRET` (routes/pagos.ts). Para engancharla: añadir a backend/vercel.json, en "crons",
 * { "path": "/api/pagos/reintentar-pasos-pendientes", "schedule": "0 * * * *" } (cada hora; en plan Hobby de Vercel solo se permite una vez al día).
 */
export async function reintentarPasosPendientes(limite: number = LIMITE_REINTENTO_CRON): Promise<ResumenReintento> {
  const { data, error } = await supabaseAdmin
    .from('pagos_pasos_pendientes')
    .select(COLUMNAS_PENDIENTE)
    .is('resuelto_at', null)
    .lt('intentos', MAX_INTENTOS_PASO)
    .order('creado_en', { ascending: true })
    .limit(limite);
  if (error) {
    logger.error({ evento: 'pago_pasos_cron_lectura_fallida', mensaje: error.message });
    return { revisados: 0, resueltos: 0, pendientes: 0 };
  }
  const filas = (data ?? []) as FilaPendiente[];
  const estado = await repararPasosFallidos(filas.map(fallidoDeFila).filter((f): f is PasoFallido => f !== null));
  return { revisados: filas.length, resueltos: filas.length - estado.pendientes.length, pendientes: estado.pendientes.length };
}

/** Todo lo que el backend necesita para completar un pago o cobro ya registrado por la RPC de dinero. */
export interface DatosPasos {
  movimientoIds: string[];
  principalId: string | null;
  grupoId: string | null;
  categoriaId: string | null;
  comprobantes: string[];
  lineas: LineaComisionPago[];
  usuarioId: string;
}

async function intentarCategoria(d: DatosPasos): Promise<PasoFallido[]> {
  if (!d.categoriaId || d.movimientoIds.length === 0) return [];
  const r = await aplicarCategoriaAMovimientos(d.movimientoIds, d.categoriaId);
  if (!r.advertencia) return [];
  const detalle: DetallePaso = { paso: 'categoria', movimientoIds: d.movimientoIds, categoriaId: d.categoriaId };
  return [{ detalle, grupoId: d.grupoId, movimientoId: d.principalId, error: 'No se pudo aplicar la categoría.' }];
}

async function intentarComprobante(d: DatosPasos): Promise<PasoFallido[]> {
  if (!d.principalId || d.comprobantes.length === 0) return [];
  const detalle: DetallePaso = { paso: 'comprobante', movimientoId: d.principalId, comprobantes: d.comprobantes };
  const r = await repetirPasoSeguro(detalle);
  return r.ok ? [] : [{ detalle, grupoId: d.grupoId, movimientoId: d.principalId, error: r.error }];
}

/** Flujo sin envoltorio SQL: cada paso se intenta aquí; los fallidos se anotan y se reintentan una vez. */
export async function aplicarPasosEnBackend(d: DatosPasos): Promise<EstadoPasos> {
  const fallidos = [...(await intentarCategoria(d)), ...(await intentarComprobante(d))];
  const comisiones: ComisionPagoCreada[] = [];
  const avisos: string[] = [];
  if (d.lineas.length > 0) {
    const c = await aplicarComisionesDePago({ movimientoIds: d.movimientoIds, grupoId: d.grupoId, lineas: d.lineas, usuarioId: d.usuarioId });
    comisiones.push(...c.comisiones);
    if (c.advertencia && !c.bancasFallidas?.length) avisos.push(c.advertencia);
    for (const bancaId of c.bancasFallidas ?? []) {
      const detalle: DetallePaso = { paso: 'comision', movimientoIds: d.movimientoIds, grupoId: d.grupoId, bancaId, usuarioId: d.usuarioId };
      fallidos.push({ detalle, grupoId: d.grupoId, movimientoId: d.principalId, error: 'No se pudo cargar la comisión.' });
    }
  }
  const reparados = await repararPasosFallidos(fallidos);
  return { comisiones: [...comisiones, ...reparados.comisiones], pendientes: reparados.pendientes, avisos };
}
