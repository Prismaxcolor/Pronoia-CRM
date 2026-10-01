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

/** Si el servidor exige llave al usuario actual para editar. La llave está activa
 *  por defecto, así que ante cualquier fallo se asume que SÍ (el superadmin no la
 *  muestra de todos modos): mejor un campo de más que un 403 sin dónde escribirla. */
export async function obtenerConfigLlaves(): Promise<ConfigLlaves> {
  try {
    return await apiFetch<ConfigLlaves>('/api/llaves-edicion/config');
  } catch {
    return { requiereLlave: true, vigenciaMinutos: 15 };
  }
}
