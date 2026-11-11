import type { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { filtroSinOcultos, idsOcultosDePeticion, peticionOcultaOcultos } from './proveedor-oculto.js';

/**
 * Productos ocultos: el superadmin puede ocultar un producto al resto de los usuarios (columna `productos.oculto`).
 * Comparte con proveedor-oculto.ts el contexto de visibilidad por petición (AsyncLocalStorage): un usuario que no es
 * superadmin, y siempre el portal, no ve los productos ocultos ni sus kilos en inventario, selectores ni listas.
 * Los documentos históricos (facturas, tickets, movimientos) NO se tocan: siguen mostrándose aunque una línea
 * referencie un producto oculto. Sin contexto (cron, webhooks, scripts) no se oculta nada.
 */

/** Ids de productos que ESTA petición no debe ver ([] para superadmin y procesos internos). */
export const idsProductosOcultos = (): Promise<string[]> => idsOcultosDePeticion('productos');

/** false si el producto está oculto para quien hace la petición. */
export async function productoVisible(id: string | null | undefined): Promise<boolean> {
  if (!id) return true;
  return !(await idsProductosOcultos()).includes(id);
}

/** Nombres (en minúsculas) de los productos ocultos para ESTA petición. Sirve donde una RPC devuelve solo el nombre. */
export async function nombresProductosOcultos(): Promise<Set<string>> {
  const ids = await idsProductosOcultos();
  if (ids.length === 0) return new Set();
  const { data } = await supabaseAdmin.from('productos').select('nombre').in('id', ids);
  return new Set((data ?? []).map(p => String(p.nombre).trim().toLowerCase()));
}

/** Quita de una lista en memoria las filas cuyo producto está oculto (las filas sin producto se conservan). */
export async function filtrarProductosOcultos<T>(filas: readonly T[], idDe: (fila: T) => string | null | undefined): Promise<T[]> {
  const ocultos = await idsProductosOcultos();
  if (ocultos.length === 0) return [...filas];
  const set = new Set(ocultos);
  return filas.filter(f => {
    const id = idDe(f);
    return !id || !set.has(id);
  });
}

interface ConOr<Q> { or(filtros: string): Q }

/** Excluye de una consulta las filas de productos ocultos. `columna` guarda el id del producto ('id' en la tabla productos). */
export function sinProductosOcultos<Q extends ConOr<Q>>(consulta: Q, ocultos: readonly string[], columna = 'producto_id'): Q {
  if (ocultos.length === 0) return consulta;
  return consulta.or(filtroSinOcultos(columna, ocultos));
}

/** Sufijo para claves de caché compartidas: separa lo que ve el superadmin de lo que ven los demás. */
export function claveVisibilidadProductos(): string {
  return peticionOcultaOcultos() ? 'vis:filtrada' : 'vis:total';
}

/** Param `:id` de un router de productos: oculto para quien consulta = 404, igual que si no existiera. */
export async function exigirProductoVisible(req: Request, res: Response, next: NextFunction, id: string): Promise<void> {
  // Ocultar/mostrar lo decide requireSuperadmin: un no-superadmin recibe siempre 403.
  if (req.method === 'POST' && req.path === `/${id}/ocultar`) {
    next();
    return;
  }
  try {
    if (!(await productoVisible(id))) {
      res.status(404).json({ error: 'Producto no encontrado.' });
      return;
    }
    next();
  } catch {
    res.status(503).json({ error: 'No se pudo verificar el producto. Intenta de nuevo.' });
  }
}

/** Oculta o muestra un producto. Devuelve el valor anterior, o un error 404/500. */
export async function establecerProductoOculto(
  id: string,
  oculto: boolean
): Promise<{ anterior: boolean; oculto: boolean } | { error: string; codigo: 404 | 500 }> {
  const { data: actual, error: errLectura } = await supabaseAdmin.from('productos').select('oculto').eq('id', id).maybeSingle();
  if (errLectura) return { error: errLectura.message, codigo: 500 };
  if (!actual) return { error: 'Producto no encontrado.', codigo: 404 };
  const anterior = (actual as { oculto: boolean | null }).oculto === true;
  const { error } = await supabaseAdmin.from('productos').update({ oculto }).eq('id', id);
  if (error) return { error: error.message, codigo: 500 };
  return { anterior, oculto };
}
