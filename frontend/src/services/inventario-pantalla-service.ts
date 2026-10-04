import { apiFetch } from './api-client';
import type {
  AlertasPantalla,
  CategoriasPantalla,
  ActualizarCostosInventario,
  ComposicionLote,
  CostosInventario,
  DetallePantalla,
} from '@shared/types/inventario-pantalla.js';

/** Servicios de los endpoints de la pantalla nueva de /inventario (contrato:
 *  shared/types/inventario-pantalla.ts). Todos devuelven `{ dato } | { error }` para que cada bloque maneje su propio fallo
 *  sin tumbar la pantalla. `params` se arma con parametrosPantalla() de lib/inventario-pantalla. */

export type Resultado<T> = { dato: T } | { error: string };

async function pedir<T>(ruta: string, clave: string, params: URLSearchParams, mensajeError: string): Promise<Resultado<T>> {
  const qs = params.toString();
  try {
    const r = await apiFetch<Record<string, T>>(`/api/inventario/pantalla/${ruta}${qs ? `?${qs}` : ''}`);
    const dato = r[clave];
    if (!dato) return { error: mensajeError };
    return { dato };
  } catch (err) {
    return { error: err instanceof Error && err.message ? err.message : mensajeError };
  }
}

export const obtenerDetallePantalla = (params: URLSearchParams) =>
  pedir<DetallePantalla>('detalle', 'detalle', params, 'No se pudo cargar el detalle del inventario.');

export const obtenerCategoriasPantalla = (params: URLSearchParams) =>
  pedir<CategoriasPantalla>('categorias', 'categorias', params, 'No se pudieron cargar las categorías del inventario.');

export const obtenerAlertasPantalla = (params: URLSearchParams) =>
  pedir<AlertasPantalla>('alertas', 'alertas', params, 'No se pudieron cargar las alertas del inventario.');

// ---- costos de referencia (facturacion:ver para leer, facturacion:editar para guardar) ----

function mensajeDe(err: unknown, porDefecto: string): string {
  return err instanceof Error && err.message ? err.message : porDefecto;
}

/** GET /api/inventario/costos: productos con stock, costo de facturas, referencia manual y costo efectivo. */
export async function obtenerCostosInventario(): Promise<Resultado<CostosInventario>> {
  try {
    const r = await apiFetch<{ costos?: CostosInventario }>('/api/inventario/costos');
    return r.costos ? { dato: r.costos } : { error: 'No se pudieron cargar los costos del inventario.' };
  } catch (err) {
    return { error: mensajeDe(err, 'No se pudieron cargar los costos del inventario.') };
  }
}

/** PUT /api/inventario/costos (máx. 500 productos; costoReferenciaKg null = quitar la referencia). Devuelve los costos actualizados. */
export async function guardarCostosInventario(items: ActualizarCostosInventario['items']): Promise<Resultado<CostosInventario>> {
  try {
    const r = await apiFetch<{ costos?: CostosInventario }>('/api/inventario/costos', { method: 'PUT', body: { items } });
    return r.costos ? { dato: r.costos } : { error: 'No se pudieron guardar los costos.' };
  } catch (err) {
    return { error: mensajeDe(err, 'No se pudieron guardar los costos.') };
  }
}

// ---- composición de un lote ----

export interface ParametrosComposicionLote {
  desde?: string | null;
  hasta?: string | null;
  almacenId?: string | null;
}

/** GET /api/inventario/pantalla/lotes/:loteId/composicion?desde&hasta&almacenId (permiso productos:ver). */
export async function obtenerComposicionLote(loteId: string, parametros: ParametrosComposicionLote = {}): Promise<Resultado<ComposicionLote>> {
  const qs = new URLSearchParams();
  if (parametros.desde) qs.set('desde', parametros.desde);
  if (parametros.hasta) qs.set('hasta', parametros.hasta);
  if (parametros.almacenId) qs.set('almacenId', parametros.almacenId);
  const q = qs.toString();
  try {
    const r = await apiFetch<{ composicion?: ComposicionLote }>(
      `/api/inventario/pantalla/lotes/${encodeURIComponent(loteId)}/composicion${q ? `?${q}` : ''}`
    );
    return r.composicion ? { dato: r.composicion } : { error: 'No se pudo cargar la composición de este lote.' };
  } catch (err) {
    return { error: mensajeDe(err, 'No se pudo cargar la composición de este lote.') };
  }
}
