import { apiFetch } from './api-client';

export interface CrearNotaAjusteInput {
  tipo: 'credito' | 'debito';
  monto: number;
  motivo: string;
}

/** Crea una nota de crédito (resta del saldo) o débito (suma al saldo) del
 *  proveedor. No genera movimiento de tesorería ni toca bancas/Cochinito. */
export async function crearNotaAjuste(
  proveedorId: string,
  input: CrearNotaAjusteInput
): Promise<{ id: string } | { error: string }> {
  try {
    return await apiFetch<{ id: string }>(`/api/proveedores/${proveedorId}/notas-ajuste`, {
      method: 'POST',
      body: input,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo crear la nota.' };
  }
}

/** Anula una nota ya creada: no se borra, se genera una nota contraria del
 *  mismo monto (regla del proyecto: en finanzas nunca se borra). */
export async function anularNotaAjuste(
  proveedorId: string,
  notaId: string,
  motivo: string
): Promise<{ id: string } | { error: string }> {
  try {
    return await apiFetch<{ id: string }>(`/api/proveedores/${proveedorId}/notas-ajuste/${notaId}/anular`, {
      method: 'POST',
      body: { motivo },
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo anular la nota.' };
  }
}
