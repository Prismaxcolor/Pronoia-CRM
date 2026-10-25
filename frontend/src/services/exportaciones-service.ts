import { apiFetch } from './api-client';
import type { ListadoExportaciones } from '@shared/types/index.js';

/** Solo en línea y sin caché local: incluye la valoración (datos de valor) y la sección exige conexión. */
export async function obtenerExportaciones(): Promise<ListadoExportaciones | { error: string }> {
  try {
    return await apiFetch<ListadoExportaciones>('/api/exportaciones');
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudieron cargar las exportaciones.' };
  }
}
