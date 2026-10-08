import { apiFetch } from './api-client';
import type { Transformacion } from '@shared/types/index.js';

export interface GuardarValoracionInput {
  facturaCompraId: string | null;
  costoUnitario: number | null;
  salidas: Array<{ id: string; precioUnitario: number | null }>;
}

export async function guardarValoracion(
  id: string,
  input: GuardarValoracionInput
): Promise<{ transformacion: Transformacion } | { error: string }> {
  try {
    const { transformacion } = await apiFetch<{ transformacion: Transformacion }>(
      `/api/transformaciones/${id}/valoracion`,
      { method: 'PATCH', body: input }
    );
    return { transformacion };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo guardar la valoración.' };
  }
}
