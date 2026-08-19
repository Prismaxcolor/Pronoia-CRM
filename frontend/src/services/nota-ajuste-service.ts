import { apiFetch } from './api-client';

export interface CrearNotaAjusteInput {
  tipo: 'credito' | 'debito';
  monto: number;
  motivo: string;
  /** Factura de compra a la que se asocia la nota — opcional: las notas también se
   *  usan como ajuste general de saldo sin factura de por medio. */
  facturaId?: string | null;
}

export interface NotaAjusteDetalle {
  id: string;
  numero: number | null;
  /** Correlativo formateado (NC-0004 / ND-0002). Null si aún no tiene numero asignado. */
  codigo: string | null;
  tipo: 'credito' | 'debito';
  monto: number;
  motivo: string;
  anulada: boolean;
  pagada: boolean;
  fecha: string;
  proveedorId: string;
  nombreProveedor: string;
  registradoPor: string | null;
  anulaNotaId: string | null;
  /** Factura de compra asociada (opcional). Null si es un ajuste general sin factura. */
  facturaAsociada: { id: string; codigo: string | null; total: number } | null;
}

/** Detalle completo de una nota para su vista tipo "ticket" (previsualización
 *  + impresión). Devuelve null si no existe o no pertenece a este proveedor. */
export async function obtenerNotaAjuste(proveedorId: string, notaId: string): Promise<NotaAjusteDetalle | null> {
  try {
    const { nota } = await apiFetch<{ nota: NotaAjusteDetalle }>(`/api/proveedores/${proveedorId}/notas-ajuste/${notaId}`);
    return nota;
  } catch {
    return null;
  }
}

/** Crea una nota de crédito (resta del saldo) o débito (suma al saldo) del
 *  proveedor. No genera movimiento de tesorería ni toca bancas/Cochinito. */
export async function crearNotaAjuste(
  proveedorId: string,
  input: CrearNotaAjusteInput
): Promise<{ id: string; codigo: string | null } | { error: string }> {
  try {
    return await apiFetch<{ id: string; codigo: string | null }>(`/api/proveedores/${proveedorId}/notas-ajuste`, {
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
