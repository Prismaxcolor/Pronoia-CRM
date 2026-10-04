import { apiFetch } from './api-client';
import type { Lote, ClaseLote } from '@shared/types/index.js';

export async function obtenerLotes(): Promise<Lote[]> {
  try {
    const { lotes } = await apiFetch<{ lotes: Lote[] }>('/api/lotes');
    return lotes;
  } catch {
    return [];
  }
}

export async function crearLote(nombre: string, fotos: string[] = []): Promise<{ lote: Lote } | { error: string }> {
  try {
    const { lote } = await apiFetch<{ lote: Lote }>('/api/lotes', {
      method: 'POST',
      body: { nombre, fotos },
    });
    return { lote };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo crear el lote.' };
  }
}

export async function actualizarLote(
  id: string,
  cambios: {
    nombre?: string;
    activo?: boolean;
    fotos?: string[];
    clase?: ClaseLote;
    /** USD/kg aproximado de VENTA; null borra el precio. */
    precioEstimadoKg?: number | null;
  }
): Promise<{ lote: Lote; advertencia?: string } | { error: string }> {
  try {
    // clase y precioEstimadoKg: solo superadmin (el resto recibe 403).
    const { lote, advertencia } = await apiFetch<{ lote: Lote; advertencia?: string }>(`/api/lotes/${id}`, {
      method: 'PATCH',
      body: cambios,
    });
    return { lote, advertencia };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo actualizar el lote.' };
  }
}

// ---------------------------------------------------------------------------
// Embalado por kilos
// ---------------------------------------------------------------------------

export interface EmbalajeLote {
  id: string;
  loteId: string;
  almacenId: string | null;
  pesoKg: number;
  nota: string | null;
  contenedor: string | null;
  marcadoPor: string | null;
  marcadoPorNombre: string | null;
  marcadoEn: string;
  anulado: boolean;
  anuladoMotivo: string | null;
  anuladoEn: string | null;
}

export interface MarcarEmbaladoInput {
  pesoKg: number;
  /** Almacén donde está lo embalado (opcional: sin almacén se valida contra el stock total del lote). */
  almacenId?: string | null;
  nota?: string;
  contenedor?: string;
}

export async function obtenerEmbalajes(loteId: string, incluirAnulados = false): Promise<EmbalajeLote[]> {
  try {
    const { embalajes } = await apiFetch<{ embalajes: EmbalajeLote[] }>(
      `/api/lotes/${loteId}/embalajes${incluirAnulados ? '?incluirAnulados=true' : ''}`
    );
    return embalajes;
  } catch {
    return [];
  }
}

/** Marca N kg del lote como embalados/listos. El servidor valida contra el stock con el lote bloqueado. */
export async function marcarEmbalado(
  loteId: string,
  input: MarcarEmbaladoInput
): Promise<{ embalaje: EmbalajeLote; advertencia?: string } | { error: string }> {
  try {
    const { embalaje, advertencia } = await apiFetch<{ embalaje: EmbalajeLote; advertencia?: string }>(`/api/lotes/${loteId}/embalajes`, {
      method: 'POST',
      body: input,
    });
    return { embalaje, advertencia };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo marcar el embalado.' };
  }
}

export async function anularEmbalaje(
  loteId: string,
  embalajeId: string,
  motivo: string
): Promise<{ embalaje: EmbalajeLote; advertencia?: string } | { error: string }> {
  try {
    const { embalaje, advertencia } = await apiFetch<{ embalaje: EmbalajeLote; advertencia?: string }>(
      `/api/lotes/${loteId}/embalajes/${embalajeId}/anular`,
      { method: 'POST', body: { motivo } }
    );
    return { embalaje, advertencia };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo anular el embalaje.' };
  }
}
