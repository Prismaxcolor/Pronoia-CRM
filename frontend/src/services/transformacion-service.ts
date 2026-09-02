import { apiFetch } from './api-client';
import type { Transformacion, SalidaComun } from '@shared/types/index.js';

// ---------------------------------------------------------------------------
// Tipos de entrada
// ---------------------------------------------------------------------------

export interface CrearTransformacionInput {
  loteOrigenId: string;
  pesoBruto: number;
  tara: number;
  fecha: string;
  notas?: string | null;
}

export interface CompletarTransformacionSalidaInput {
  loteDestinoId: string;
  pesoBruto: number;
  tara: number;
}

export interface CrearTransformacionFerrosoInput {
  productoEntradaId: string;
  almacenId: string;
  pesoBruto: number;
  tara: number;
  fecha: string;
  notas?: string | null;
  fotosEntrada: string[];
}

export interface CompletarTransformacionFerrosoSalidaInput {
  productoId: string;
  pesoBruto: number;
  tara: number;
  fotos: string[];
}

export interface ObtenerTransformacionesOpts {
  desde?: string;
  hasta?: string;
  estado?: 'bruto' | 'completa';
  categoria?: string;
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export async function obtenerTransformaciones(
  opts: ObtenerTransformacionesOpts = {}
): Promise<Transformacion[]> {
  const params = new URLSearchParams();
  if (opts.desde) params.set('desde', opts.desde);
  if (opts.hasta) params.set('hasta', opts.hasta);
  if (opts.estado) params.set('estado', opts.estado);
  if (opts.categoria) params.set('categoria', opts.categoria);
  const qs = params.toString();
  try {
    const { transformaciones } = await apiFetch<{ transformaciones: Transformacion[] }>(
      `/api/transformaciones${qs ? `?${qs}` : ''}`
    );
    return transformaciones;
  } catch {
    return [];
  }
}

export async function obtenerTransformacion(id: string): Promise<Transformacion | null> {
  try {
    const { transformacion } = await apiFetch<{ transformacion: Transformacion }>(`/api/transformaciones/${id}`);
    return transformacion;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Legacy (lote-pool)
// ---------------------------------------------------------------------------

export async function crearTransformacion(
  input: CrearTransformacionInput
): Promise<{ transformacion: Transformacion } | { error: string }> {
  try {
    const { transformacion } = await apiFetch<{ transformacion: Transformacion }>('/api/transformaciones', {
      method: 'POST',
      body: input,
    });
    return { transformacion };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo registrar la transformación.' };
  }
}

export async function completarTransformacion(
  id: string,
  salidas: CompletarTransformacionSalidaInput[]
): Promise<{ transformacion: Transformacion } | { error: string }> {
  try {
    const { transformacion } = await apiFetch<{ transformacion: Transformacion }>(
      `/api/transformaciones/${id}/completar`,
      { method: 'PATCH', body: { salidas } }
    );
    return { transformacion };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo completar la transformación.' };
  }
}

// ---------------------------------------------------------------------------
// Ferroso / No Ferroso
// ---------------------------------------------------------------------------

export async function crearTransformacionFerroso(
  input: CrearTransformacionFerrosoInput
): Promise<{ transformacion: Transformacion } | { error: string }> {
  try {
    const { transformacion } = await apiFetch<{ transformacion: Transformacion }>('/api/transformaciones/ferroso', {
      method: 'POST',
      body: input,
    });
    return { transformacion };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo registrar la transformación.' };
  }
}

export async function completarTransformacionFerroso(
  id: string,
  salidas: CompletarTransformacionFerrosoSalidaInput[]
): Promise<{ transformacion: Transformacion } | { error: string }> {
  try {
    const { transformacion } = await apiFetch<{ transformacion: Transformacion }>(
      `/api/transformaciones/${id}/completar-ferroso`,
      { method: 'PATCH', body: { salidas } }
    );
    return { transformacion };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo completar la transformación.' };
  }
}

// ---------------------------------------------------------------------------
// Salidas comunes (config)
// ---------------------------------------------------------------------------

export async function obtenerSalidasComunes(productoEntradaId?: string): Promise<SalidaComun[]> {
  const qs = productoEntradaId ? `?productoEntradaId=${productoEntradaId}` : '';
  try {
    const { salidas } = await apiFetch<{ salidas: SalidaComun[] }>(`/api/transformaciones/config/salidas-comunes${qs}`);
    return salidas;
  } catch {
    return [];
  }
}

export async function guardarSalidasComunes(
  productoEntradaId: string,
  productosSalidaIds: string[]
): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/transformaciones/config/salidas-comunes/${productoEntradaId}`, {
      method: 'PUT',
      body: { productosSalidaIds },
    });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo guardar la configuración.' };
  }
}

// ---------------------------------------------------------------------------
// PCB
// ---------------------------------------------------------------------------

export interface CrearTransformacionPCBInput {
  loteOrigenId: string;
  pesoBruto: number;
  tara: number;
  fecha: string;
  notas?: string | null;
  fotosEntrada: string[];
}

export interface CompletarTransformacionPCBInput {
  loteDestinoId: string;
  pesoBruto: number;
  tara: number;
  fotos: string[];
}

export async function crearTransformacionPCB(
  input: CrearTransformacionPCBInput
): Promise<{ transformacion: Transformacion } | { error: string }> {
  try {
    const { transformacion } = await apiFetch<{ transformacion: Transformacion }>('/api/transformaciones/pcb', {
      method: 'POST',
      body: input,
    });
    return { transformacion };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo registrar la transformación PCB.' };
  }
}

export async function completarTransformacionPCB(
  id: string,
  input: CompletarTransformacionPCBInput
): Promise<{ transformacion: Transformacion } | { error: string }> {
  try {
    const { transformacion } = await apiFetch<{ transformacion: Transformacion }>(
      `/api/transformaciones/${id}/completar-pcb`,
      { method: 'PATCH', body: input }
    );
    return { transformacion };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo completar la transformación PCB.' };
  }
}

// ---------------------------------------------------------------------------
// Eliminar
// ---------------------------------------------------------------------------

export async function borrarTransformacion(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/transformaciones/${id}`, { method: 'DELETE' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo cancelar la transformación.' };
  }
}
