import { apiFetch } from './api-client';
import type { TipoMaterial } from '@shared/types/index.js';

export interface TipoMaterialInput {
  nombre: string;
  descripcion?: string | null;
}

export async function obtenerTiposMaterial(): Promise<TipoMaterial[]> {
  try {
    const { tipos } = await apiFetch<{ tipos: TipoMaterial[] }>('/api/tipos-material');
    return tipos;
  } catch {
    return [];
  }
}

export async function crearTipoMaterial(
  input: TipoMaterialInput
): Promise<{ tipo: TipoMaterial } | { error: string }> {
  try {
    const { tipo } = await apiFetch<{ tipo: TipoMaterial }>('/api/tipos-material', {
      method: 'POST',
      body: input,
    });
    return { tipo };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo crear la categoría.' };
  }
}

export async function actualizarTipoMaterial(
  id: string,
  cambios: Partial<TipoMaterialInput> & { activo?: boolean }
): Promise<{ tipo: TipoMaterial } | { error: string }> {
  try {
    const { tipo } = await apiFetch<{ tipo: TipoMaterial }>(`/api/tipos-material/${id}`, {
      method: 'PATCH',
      body: cambios,
    });
    return { tipo };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo actualizar la categoría.' };
  }
}

export async function desactivarTipoMaterial(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/tipos-material/${id}/desactivar`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo desactivar la categoría.' };
  }
}

export async function reactivarTipoMaterial(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/tipos-material/${id}/reactivar`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo reactivar la categoría.' };
  }
}
