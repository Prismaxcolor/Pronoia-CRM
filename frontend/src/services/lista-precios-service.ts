import { apiFetch } from './api-client';
import { leerGet } from './lectura-service';
import { obtenerCatalogo } from '../lib/offline/catalogos';
import type { ListaPrecios, PrecioLista, TipoListaPrecios } from '@shared/types/index.js';

/** Lista activa con el precio de un material concreto (para el selector). */
export interface ListaParaProducto {
  listaId: string;
  nombre: string;
  vigenteDesde: string | null;
  precio: number;
}

export interface CrearListaInput {
  nombre: string;
  tipo: TipoListaPrecios;
  vigenteDesde?: string | null;
}

export interface ActualizarListaInput {
  nombre?: string;
  vigenteDesde?: string | null;
  activo?: boolean;
}

/** Sin `tipo`, trae todas (pantalla de Configuración). Con `tipo`, filtra —
 *  usar al armar el selector de una factura. */
export async function obtenerListas(tipo?: TipoListaPrecios): Promise<ListaPrecios[]> {
  try {
    const qs = tipo ? `?tipo=${tipo}` : '';
    const { datos } = await obtenerCatalogo(`listas-precios:${tipo ?? 'todas'}`, async () => {
      const { listas } = await apiFetch<{ listas: ListaPrecios[] }>(`/api/listas-precios${qs}`);
      return listas;
    });
    return datos;
  } catch {
    return [];
  }
}

export async function obtenerListaDetalle(
  id: string
): Promise<{ lista: ListaPrecios; precios: PrecioLista[] } | null> {
  try {
    return await apiFetch<{ lista: ListaPrecios; precios: PrecioLista[] }>(
      `/api/listas-precios/${id}`
    );
  } catch {
    return null;
  }
}

export async function crearLista(
  input: CrearListaInput
): Promise<{ lista: ListaPrecios } | { error: string }> {
  try {
    const { lista } = await apiFetch<{ lista: ListaPrecios }>('/api/listas-precios', {
      method: 'POST',
      body: input,
    });
    return { lista };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo crear la lista.' };
  }
}

export async function actualizarLista(
  id: string,
  cambios: ActualizarListaInput
): Promise<{ lista: ListaPrecios } | { error: string }> {
  try {
    const { lista } = await apiFetch<{ lista: ListaPrecios }>(`/api/listas-precios/${id}`, {
      method: 'PATCH',
      body: cambios,
    });
    return { lista };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo actualizar la lista.' };
  }
}

export async function eliminarLista(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/listas-precios/${id}`, { method: 'DELETE' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo eliminar la lista.' };
  }
}

export async function upsertPrecioEnLista(
  listaId: string,
  productoId: string,
  precio: number
): Promise<{ precio: PrecioLista } | { error: string }> {
  try {
    const { precio: guardado } = await apiFetch<{ precio: PrecioLista }>(
      `/api/listas-precios/${listaId}/precios`,
      { method: 'PUT', body: { productoId, precio } }
    );
    return { precio: guardado };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo guardar el precio.' };
  }
}

export async function eliminarPrecio(
  listaId: string,
  productoId: string
): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/listas-precios/${listaId}/precios/${productoId}`, { method: 'DELETE' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo eliminar el precio.' };
  }
}

/** Guarda el orden manual: productoIds de todos los materiales, de arriba a abajo. */
export async function reordenarPrecios(
  listaId: string,
  productoIds: string[]
): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/listas-precios/${listaId}/precios/reordenar`, {
      method: 'PATCH',
      body: { productoIds },
    });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo reordenar la lista.' };
  }
}

/** Listas activas (del tipo dado) que tienen un precio definido para el material. */
export async function obtenerListasParaProducto(
  productoId: string,
  tipo: TipoListaPrecios
): Promise<ListaParaProducto[]> {
  try {
    const { listas } = await leerGet<{ listas: ListaParaProducto[] }>(
      `/api/listas-precios/para-producto/${productoId}?tipo=${tipo}`
    );
    return listas;
  } catch {
    return [];
  }
}
