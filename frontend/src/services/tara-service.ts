import { apiFetch } from './api-client';
import { altaMaestroF4, fotosYaSubidas, provisionalesDeMaestro } from './maestros-cola';
import { offlineHabilitado } from '../lib/offline/sesion';
import type { FotoLocal } from '../lib/foto-picker';
import { obtenerCatalogo } from '../lib/offline/catalogos';
import type { Tara } from '@shared/types/index.js';

export interface TaraInput {
  nombre: string;
  peso: number;
  fotos?: string[];
}

export async function obtenerTaras(): Promise<Tara[]> {
  try {
    const { datos } = await obtenerCatalogo('taras', async () => {
      const { taras } = await apiFetch<{ taras: Tara[] }>('/api/taras');
      return taras;
    });
    return [...datos, ...(await provisionalesDeMaestro<Tara>('tara'))];
  } catch {
    return provisionalesDeMaestro<Tara>('tara');
  }
}

export async function crearTara(input: TaraInput, fotosLocales?: FotoLocal[]): Promise<{ tara: Tara; enCola?: true } | { error: string }> {
  if (offlineHabilitado()) {
    const { fotos, ...datos } = input;
    const r = await altaMaestroF4<Tara>('tara', datos, fotosLocales ?? fotosYaSubidas(fotos));
    if ('error' in r) return r;
    return { tara: r.entidad, ...(r.enCola ? { enCola: true as const } : {}) };
  }
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
