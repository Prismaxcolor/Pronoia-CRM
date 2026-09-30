import { apiFetch } from './api-client';
import type { EntidadConLlave } from './auditoria-service';

export interface LlaveGenerada {
  /** Código en claro: el backend solo lo devuelve en esta respuesta. */
  codigo: string;
  expiraEn: string;
}

export interface ConfigLlaves {
  requiereLlave: boolean;
  vigenciaMinutos: number;
}

/** Solo superadmin. Genera una llave de un solo uso ligada a un documento. */
export async function generarLlaveEdicion(
  entidadTipo: EntidadConLlave,
  entidadId: string
): Promise<LlaveGenerada | { error: string }> {
  try {
    return await apiFetch<LlaveGenerada>('/api/llaves-edicion', {
      method: 'POST',
      body: { entidadTipo, entidadId },
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo generar la llave.' };
  }
}

/** Si el servidor exige llave al usuario actual para editar (REQUIRE_EDIT_KEY).
 *  Ante cualquier fallo asume que no, para no mostrar un campo que no aplica. */
export async function obtenerConfigLlaves(): Promise<ConfigLlaves> {
  try {
    return await apiFetch<ConfigLlaves>('/api/llaves-edicion/config');
  } catch {
    return { requiereLlave: false, vigenciaMinutos: 15 };
  }
}
