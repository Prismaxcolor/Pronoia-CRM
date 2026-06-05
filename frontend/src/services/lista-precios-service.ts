import { apiFetch } from './api-client';
import type { ListaPrecios, PrecioLista } from '@shared/types/index.js';

/** Lista activa con el precio de un material concreto (para el selector). */
export interface ListaParaProducto {
  listaId: string;
  nombre: string;
  vigenteDesde: string | null;
  precio: number;
}

export interface CrearListaInput {
  nombre: string;
  vigenteDesde?: string | null;
}

export interface ActualizarListaInput {
  nombre?: string;
  vigenteDesde?: string | null;
  activo?: boolean;
}

export async function obtenerListas(): Promise<ListaPrecios[]> {
  try {
    const { listas } = await apiFetch<{ listas: ListaPrecios[] }>('/api/listas-precios');
    return listas;
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

/** Listas activas que tienen un precio definido para el material dado. */
export async function obtenerListasParaProducto(productoId: string): Promise<ListaParaProducto[]> {
  try {
    const { listas } = await apiFetch<{ listas: ListaParaProducto[] }>(
      `/api/listas-precios/para-producto/${productoId}`
    );
    return listas;
  } catch {
    return [];
  }
}
