import { apiFetch } from './api-client';
import type { Transformacion } from '@shared/types/index.js';

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

export interface ObtenerTransformacionesOpts {
  desde?: string;
  hasta?: string;
  estado?: 'bruto' | 'completa';
}

export async function obtenerTransformaciones(
  opts: ObtenerTransformacionesOpts = {}
): Promise<Transformacion[]> {
  const params = new URLSearchParams();
  if (opts.desde) params.set('desde', opts.desde);
  if (opts.hasta) params.set('hasta', opts.hasta);
  if (opts.estado) params.set('estado', opts.estado);
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

/** Retira material de un lote-pool en 'bruto'. El backend calcula y persiste
 *  el reparto proporcional por producto (promedio ponderado). */
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

/** Completa una transformación 'bruto' con sus salidas reales pesadas. */
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

/** Cancela una transformación que todavía está en 'bruto'. El backend
 *  rechaza si ya se completó. */
export async function borrarTransformacion(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/transformaciones/${id}`, { method: 'DELETE' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo cancelar la transformación.' };
  }
}
