import { apiFetch, esErrorDeRed } from './api-client';
import { leerGet } from './lectura-service';
import { LIMITES_CACHE, recortarCampo, ultimasFilas } from '../lib/offline/lectura-logica';
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
  /** Identificador de la operación (modo sin conexión): hace seguro un reintento. */
  clientRequestId?: string;
  /** Momento real (ISO) en que se hizo la operación. */
  capturadoEn?: string;
}

export interface RecepcionMaterialInput {
  detalleId: string;
  pesoRecibido: number;
}

export async function obtenerTraslados(): Promise<Traslado[]> {
  try {
    const { traslados } = await leerGet<{ traslados: Traslado[] }>('/api/traslados', {
      recortar: d => recortarCampo(d, 'traslados', f => ultimasFilas(f as Traslado[], LIMITES_CACHE.maxTraslados, t => t.createdAt)),
    });
    return traslados;
  } catch {
    return [];
  }
}

export async function obtenerTraslado(id: string): Promise<Traslado | null> {
  try {
    const { traslado } = await leerGet<{ traslado: Traslado }>(`/api/traslados/${id}`);
    return traslado;
  } catch {
    return null;
  }
}

export async function crearTraslado(
  input: CrearTrasladoInput
): Promise<{ traslado: Traslado } | { error: string; red?: true }> {
  try {
    const { traslado } = await apiFetch<{ traslado: Traslado }>('/api/traslados', {
      method: 'POST',
      body: input,
    });
    return { traslado };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'No se pudo guardar el traslado.',
      ...(esErrorDeRed(err) ? { red: true as const } : {}),
    };
  }
}

export async function completarTraslado(
  id: string,
  recepciones: RecepcionMaterialInput[],
  fotos: string[],
  /** Identidad de la operación (modo sin conexión): reintentos seguros. */
  identidad: { clientRequestId?: string; capturadoEn?: string } = {}
): Promise<{ traslado: Traslado } | { error: string; red?: true }> {
  try {
    const { traslado } = await apiFetch<{ traslado: Traslado }>(`/api/traslados/${id}/completar`, {
      method: 'PATCH',
      body: { recepciones, fotos, ...identidad },
    });
    return { traslado };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'No se pudo completar el traslado.',
      ...(esErrorDeRed(err) ? { red: true as const } : {}),
    };
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
