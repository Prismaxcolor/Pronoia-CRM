import { apiFetch } from './api-client';
import type { Lote } from '@shared/types/index.js';

export async function obtenerLotes(): Promise<Lote[]> {
  try {
    const { lotes } = await apiFetch<{ lotes: Lote[] }>('/api/lotes');
    return lotes;
  } catch {
    return [];
  }
}

export async function crearLote(nombre: string, almacenId: string, fotos: string[] = []): Promise<{ lote: Lote } | { error: string }> {
  try {
    const { lote } = await apiFetch<{ lote: Lote }>('/api/lotes', {
      method: 'POST',
      body: { nombre, almacenId, fotos },
    });
    return { lote };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo crear el lote.' };
  }
}

export async function actualizarLote(
  id: string,
  cambios: { nombre?: string; activo?: boolean; almacenId?: string; fotos?: string[] }
): Promise<{ lote: Lote } | { error: string }> {
  try {
    const { lote } = await apiFetch<{ lote: Lote }>(`/api/lotes/${id}`, {
      method: 'PATCH',
      body: cambios,
    });
    return { lote };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo actualizar el lote.' };
  }
}
