import { apiFetch } from './api-client';
import type { Almacen } from '@shared/types/index.js';

export interface AlmacenInput {
  nombre: string;
  detalle?: string | null;
}

export async function obtenerAlmacenes(): Promise<Almacen[]> {
  try {
    const { almacenes } = await apiFetch<{ almacenes: Almacen[] }>('/api/almacenes');
    return almacenes;
  } catch {
    return [];
  }
}

/** Stock actual (kg) por productoId en un almacén, derivado de traslados completados. */
export async function obtenerStockAlmacen(almacenId: string): Promise<Map<string, number>> {
  try {
    const { stock } = await apiFetch<{ stock: Record<string, number> }>(`/api/almacenes/${almacenId}/stock`);
    return new Map(Object.entries(stock));
  } catch {
    return new Map();
  }
}

export async function crearAlmacen(input: AlmacenInput): Promise<{ almacen: Almacen } | { error: string }> {
  try {
    const { almacen } = await apiFetch<{ almacen: Almacen }>('/api/almacenes', {
      method: 'POST',
      body: input,
    });
    return { almacen };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo crear el almacén.' };
  }
}

export async function actualizarAlmacen(
  id: string,
  cambios: Partial<AlmacenInput> & { activo?: boolean }
): Promise<{ almacen: Almacen } | { error: string }> {
  try {
    const { almacen } = await apiFetch<{ almacen: Almacen }>(`/api/almacenes/${id}`, {
      method: 'PATCH',
      body: cambios,
    });
    return { almacen };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo actualizar el almacén.' };
  }
}

export async function desactivarAlmacen(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/almacenes/${id}/desactivar`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo desactivar el almacén.' };
  }
}

export async function reactivarAlmacen(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/almacenes/${id}/reactivar`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo reactivar el almacén.' };
  }
}
