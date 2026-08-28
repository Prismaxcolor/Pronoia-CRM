import { apiFetch } from './api-client';
import type { Tara } from '@shared/types/index.js';

export interface TaraInput {
  nombre: string;
  peso: number;
  fotos?: string[];
}

export async function obtenerTaras(): Promise<Tara[]> {
  try {
    const { taras } = await apiFetch<{ taras: Tara[] }>('/api/taras');
    return taras;
  } catch {
    return [];
  }
}

export async function crearTara(input: TaraInput): Promise<{ tara: Tara } | { error: string }> {
  try {
    const { tara } = await apiFetch<{ tara: Tara }>('/api/taras', {
      method: 'POST',
      body: input,
    });
    return { tara };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo crear la tara.' };
  }
}

export async function actualizarTara(
  id: string,
  cambios: Partial<TaraInput> & { activo?: boolean }
): Promise<{ tara: Tara } | { error: string }> {
  try {
    const { tara } = await apiFetch<{ tara: Tara }>(`/api/taras/${id}`, {
      method: 'PATCH',
      body: cambios,
    });
    return { tara };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo actualizar la tara.' };
  }
}

export async function desactivarTara(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/taras/${id}/desactivar`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo desactivar la tara.' };
  }
}

export async function reactivarTara(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/taras/${id}/reactivar`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo reactivar la tara.' };
  }
}
