import { apiFetch } from './api-client';
import type { Traslado } from '@shared/types/index.js';

export interface CrearTrasladoMaterialInput {
  productoId: string;
  subcategoria?: string | null;
  pesoBruto: number;
  tara: number;
}

export interface CrearTrasladoInput {
  almacenOrigenId: string;
  almacenDestinoId: string;
  materiales: CrearTrasladoMaterialInput[];
  observaciones?: string | null;
}

export interface RecepcionMaterialInput {
  detalleId: string;
  pesoRecibido: number;
}

export async function obtenerTraslados(): Promise<Traslado[]> {
  try {
    const { traslados } = await apiFetch<{ traslados: Traslado[] }>('/api/traslados');
    return traslados;
  } catch {
    return [];
  }
}

export async function obtenerTraslado(id: string): Promise<Traslado | null> {
  try {
    const { traslado } = await apiFetch<{ traslado: Traslado }>(`/api/traslados/${id}`);
    return traslado;
  } catch {
    return null;
  }
}

export async function crearTraslado(
  input: CrearTrasladoInput
): Promise<{ traslado: Traslado } | { error: string }> {
  try {
    const { traslado } = await apiFetch<{ traslado: Traslado }>('/api/traslados', {
      method: 'POST',
      body: input,
    });
    return { traslado };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo guardar el traslado.' };
  }
}

export async function completarTraslado(
  id: string,
  recepciones: RecepcionMaterialInput[],
  fotos: string[]
): Promise<{ traslado: Traslado } | { error: string }> {
  try {
    const { traslado } = await apiFetch<{ traslado: Traslado }>(`/api/traslados/${id}/completar`, {
      method: 'PATCH',
      body: { recepciones, fotos },
    });
    return { traslado };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo completar el traslado.' };
  }
}
