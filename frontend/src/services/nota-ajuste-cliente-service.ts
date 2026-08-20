import { apiFetch } from './api-client';

/** Espejo de nota-ajuste-service.ts para clientes (Bloque 45) — mismo shape,
 *  apunta a /api/clientes/.../notas-ajuste en vez de /api/proveedores/. */

export interface CrearNotaAjusteClienteInput {
  tipo: 'credito' | 'debito';
  monto: number;
  motivo: string;
  facturaId?: string | null;
  fecha?: string;
}

export interface NotaAjusteClienteDetalle {
  id: string;
  numero: number | null;
  /** Correlativo formateado (NCV-0004 / NDV-0002). Null si aún no tiene numero asignado. */
  codigo: string | null;
  tipo: 'credito' | 'debito';
  monto: number;
  motivo: string;
  anulada: boolean;
  pagada: boolean;
  fecha: string;
  clienteId: string;
  nombreCliente: string;
  registradoPor: string | null;
  anulaNotaId: string | null;
  facturaAsociada: { id: string; codigo: string | null; total: number } | null;
}

export async function obtenerNotaAjusteCliente(clienteId: string, notaId: string): Promise<NotaAjusteClienteDetalle | null> {
  try {
    const { nota } = await apiFetch<{ nota: NotaAjusteClienteDetalle }>(`/api/clientes/${clienteId}/notas-ajuste/${notaId}`);
    return nota;
  } catch {
    return null;
  }
}

/** Crea una nota de crédito (resta del saldo) o débito (suma al saldo) del
 *  cliente. No genera movimiento de tesorería ni toca bancas/Cochinito. */
export async function crearNotaAjusteCliente(
  clienteId: string,
  input: CrearNotaAjusteClienteInput
): Promise<{ id: string; codigo: string | null } | { error: string }> {
  try {
    return await apiFetch<{ id: string; codigo: string | null }>(`/api/clientes/${clienteId}/notas-ajuste`, {
      method: 'POST',
      body: input,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo crear la nota.' };
  }
}

export async function anularNotaAjusteCliente(
  clienteId: string,
  notaId: string,
  motivo: string
): Promise<{ id: string } | { error: string }> {
  try {
    return await apiFetch<{ id: string }>(`/api/clientes/${clienteId}/notas-ajuste/${notaId}/anular`, {
      method: 'POST',
      body: { motivo },
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo anular la nota.' };
  }
}
