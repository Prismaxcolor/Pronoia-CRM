import { apiFetch } from './api-client';
import type { Traslado } from '@shared/types/index.js';

export interface CrearTrasladoMaterialInput {
  productoId: string;
  subcategoria?: string | null;
  pesoBruto: number;
  tara: number;
  fotos: string[];
}

export interface CrearTrasladoLoteInput {
  loteId: string;
  pesoBruto: number;
  tara: number;
  fotos: string[];
}

export interface CrearTrasladoInput {
  almacenOrigenId: string;
  almacenDestinoId: string;
  materiales: CrearTrasladoMaterialInput[];
  /** Lotes (PCB) a trasladar completos — se pesan igual que un material. */
  lotes: CrearTrasladoLoteInput[];
  /** Placa/identificador del vehículo que hace el traslado. */
  vehiculo?: string | null;
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

// ---------------------------------------------------------------------------
// Edición de observaciones y pesos (protegida por llave y auditada en el servidor)
// ---------------------------------------------------------------------------

export interface EditarTrasladoLineaInput {
  id: string;
  pesoBruto?: number;
  tara?: number;
  /** Solo si el traslado ya fue recepcionado. */
  pesoRecibido?: number;
}

export interface EditarTrasladoInput {
  observaciones?: string;
  /** Solo las líneas que cambian. El neto no se envía: es bruto - tara. */
  lineas?: EditarTrasladoLineaInput[];
  llaveEdicion?: string;
}

export async function editarTraslado(
  id: string,
  input: EditarTrasladoInput
): Promise<{ traslado: Traslado; advertencia?: string } | { error: string }> {
  try {
    return await apiFetch<{ traslado: Traslado; advertencia?: string }>(`/api/traslados/${id}/editar`, {
      method: 'PATCH',
      body: input,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo editar el traslado.' };
  }
}
