import { apiFetch } from './api-client';

export interface SalidaTransformacion {
  materialSalidaId: string;
  nombre: string;
  cantidad: number;
}

export interface TransformacionHistorial {
  id: string;
  fecha: string | null;
  materialEntradaId: string | null;
  nombreEntrada: string;
  cantidadEntrada: number;
  salidas: SalidaTransformacion[];
  merma: number;
  notas: string | null;
  createdAt: string;
}

export interface CrearTransformacionInput {
  materialEntradaId: string;
  cantidadEntrada: number;
  fecha?: string | null;
  notas?: string | null;
  detalles: { materialSalidaId: string; cantidad: number }[];
}

export async function obtenerTransformaciones(
  filtros: { desde?: string; hasta?: string } = {}
): Promise<TransformacionHistorial[]> {
  const params = new URLSearchParams();
  if (filtros.desde) params.set('desde', filtros.desde);
  if (filtros.hasta) params.set('hasta', filtros.hasta);
  const qs = params.toString();
  try {
    const { transformaciones } = await apiFetch<{ transformaciones: TransformacionHistorial[] }>(
      `/api/transformaciones${qs ? `?${qs}` : ''}`
    );
    return transformaciones;
  } catch {
    return [];
  }
}

export async function crearTransformacion(
  input: CrearTransformacionInput
): Promise<{ id: string } | { error: string }> {
  try {
    const res = await apiFetch<{ id: string }>('/api/transformaciones', { method: 'POST', body: input });
    return res;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo registrar la transformación.' };
  }
}
