import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';

/**
 * Proveedores ocultos: el superadmin puede ocultar un proveedor al resto de los usuarios (columna
 * `proveedores.oculto`). El filtro vive aquí, en un único punto del backend:
 *
 *  - requireAuth / requirePortalAuth abren un contexto por petición (AsyncLocalStorage) que dice si ESTA
 *    petición debe ocultarlos (todo rol distinto de superadmin, y siempre el portal).
 *  - Los servicios que leen proveedores, o documentos con proveedor_id, piden los ids ocultos con
 *    idsProveedoresOcultos() y los excluyen con sinProveedoresOcultos() / filtrarOcultos().
 *  - Sin contexto (cron, webhooks de n8n, scripts) no se oculta nada: son procesos internos.
 */

interface ContextoVisibilidad {
  ocultar: boolean;
  /** Ids ocultos leídos una sola vez por petición. */
  ids?: Promise<string[]>;
}

const almacen = new AsyncLocalStorage<ContextoVisibilidad>();

/** Ejecuta `fn` (y todo lo asíncrono que dispare) con la visibilidad de proveedores indicada. */
export function conVisibilidadProveedores<T>(ocultar: boolean, fn: () => T): T {
  return almacen.run({ ocultar }, fn);
}

/** Middleware: abre el contexto según el rol del usuario ya autenticado (req.user). Va justo tras validar el token. */
export function contextoVisibilidadStaff(req: Request, _res: Response, next: NextFunction): void {
  conVisibilidadProveedores(req.user?.rol !== 'superadmin', next);
}

const CODIGO_COLUMNA_INEXISTENTE = '42703';

/** Lee los ids ocultos sin mirar el contexto de la petición (para procesos internos, p. ej. los avisos del grupo). */
export async function leerIdsOcultos(): Promise<string[]> {
  const { data, error } = await supabaseAdmin.from('proveedores').select('id, oculto').eq('oculto', true);
  if (error) {
    // Migración sin aplicar: todavía no existe la columna, así que no hay nada oculto.
    if (error.code === CODIGO_COLUMNA_INEXISTENTE) {
      logger.warn({ evento: 'proveedores_oculto_columna_inexistente', mensaje: 'Falta aplicar migration_proveedores_oculto.sql: ningún proveedor queda oculto.' });
      return [];
    }
    logger.error({ evento: 'proveedores_ocultos_lectura_fallida', error: error.message });
    throw new Error('No se pudo verificar la visibilidad de los proveedores.');
  }
  // Se vuelve a comprobar la marca: solo cuenta lo que la fila dice expresamente (oculto === true).
  return (Array.isArray(data) ? (data as Array<{ id: string; oculto?: boolean }>) : []).filter(p => p.oculto === true).map(p => p.id);
}

/** Ids de proveedores que ESTA petición no debe ver ([] para superadmin y procesos internos). */
export async function idsProveedoresOcultos(): Promise<string[]> {
  const ctx = almacen.getStore();
  if (!ctx?.ocultar) return [];
  ctx.ids ??= leerIdsOcultos();
  try {
    return await ctx.ids;
  } catch (e) {
    ctx.ids = undefined; // el próximo intento vuelve a consultar
    throw e;
  }
}

/** false si el proveedor está oculto para quien hace la petición. */
export async function proveedorVisible(id: string | null | undefined): Promise<boolean> {
  if (!id) return true;
  return !(await idsProveedoresOcultos()).includes(id);
}

/** Quita de una lista en memoria las filas cuyo proveedor está oculto. */
export async function filtrarOcultos<T>(filas: readonly T[], idDe: (fila: T) => string | null | undefined): Promise<T[]> {
  const ocultos = await idsProveedoresOcultos();
  if (ocultos.length === 0) return [...filas];
  const set = new Set(ocultos);
  return filas.filter(f => {
    const id = idDe(f);
    return !id || !set.has(id);
  });
}

/** Filtro PostgREST (para `.or()`) que deja pasar las filas sin proveedor y las de proveedores no ocultos. */
export function filtroSinOcultos(columna: string, ocultos: readonly string[], extraPermitido?: string): string {
  const lista = ocultos.join(',');
  const partes = [`${columna}.is.null`, `${columna}.not.in.(${lista})`];
  if (extraPermitido) partes.unshift(extraPermitido);
  return partes.join(',');
}

interface ConOr<Q> { or(filtros: string): Q }

/**
 * Excluye de una consulta las filas de proveedores ocultos. `columna` es la que guarda el id del proveedor
 * (p. ej. proveedor_id; 'id' en la propia tabla proveedores). `extraPermitido` deja pasar además las filas que
 * cumplan ese filtro PostgREST (p. ej. 'tipo.neq.compra' cuando la columna es polimórfica).
 */
export function sinProveedoresOcultos<Q extends ConOr<Q>>(consulta: Q, ocultos: readonly string[], columna: string, extraPermitido?: string): Q {
  if (ocultos.length === 0) return consulta;
  return consulta.or(filtroSinOcultos(columna, ocultos, extraPermitido));
}

/**
 * Param `:id` de un router de proveedores: si el proveedor está oculto para quien consulta responde 404,
 * igual que si no existiera (no revela que existe).
 */
export async function exigirProveedorVisible(req: Request, res: Response, next: NextFunction, id: string): Promise<void> {
  // Ocultar/mostrar lo decide requireSuperadmin: un no-superadmin recibe siempre 403, exista o esté oculto el proveedor.
  if (req.method === 'POST' && req.path === `/${id}/ocultar`) {
    next();
    return;
  }
  try {
    if (!(await proveedorVisible(id))) {
      res.status(404).json({ error: 'Proveedor no encontrado.' });
      return;
    }
    next();
  } catch {
    res.status(503).json({ error: 'No se pudo verificar el proveedor. Intenta de nuevo.' });
  }
}

/** Oculta o muestra un proveedor. Devuelve el valor anterior, o null si el proveedor no existe. */
export async function establecerProveedorOculto(
  id: string,
  oculto: boolean
): Promise<{ anterior: boolean; oculto: boolean } | { error: string; codigo: 404 | 500 }> {
  const { data: actual, error: errLectura } = await supabaseAdmin.from('proveedores').select('oculto').eq('id', id).maybeSingle();
  if (errLectura) return { error: errLectura.message, codigo: 500 };
  if (!actual) return { error: 'Proveedor no encontrado.', codigo: 404 };
  const anterior = (actual as { oculto: boolean | null }).oculto === true;
  const { error } = await supabaseAdmin.from('proveedores').update({ oculto }).eq('id', id);
  if (error) return { error: error.message, codigo: 500 };
  return { anterior, oculto };
}

/** Para lecturas genéricas por tabla ('proveedores' | 'clientes' | ...): solo la de proveedores se filtra. */
export async function sinOcultosDeTabla<T extends { id: string }>(tabla: string, filas: readonly T[]): Promise<T[]> {
  return tabla === 'proveedores' ? filtrarOcultos(filas, f => f.id) : [...filas];
}
