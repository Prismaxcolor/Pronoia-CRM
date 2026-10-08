import { apiFetch } from './api-client';

export interface CrearNotaAjusteInput {
  tipo: 'credito' | 'debito';
  monto: number;
  motivo: string;
  /** Factura de compra a la que se asocia la nota — opcional: las notas también se
   *  usan como ajuste general de saldo sin factura de por medio. */
  facturaId?: string | null;
  /** Fecha de negocio de la nota (YYYY-MM-DD). Si se omite, la BD usa hoy. */
  fecha?: string;
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
  /** Instante (timestamptz) en que se registró la nota. */
  registradoEn?: string | null;
  anulaNotaId: string | null;
  /** Datos de la anulación (null si la nota no está anulada). */
  anuladaAt: string | null;
  anuladaPor: string | null;
  anuladaMotivo: string | null;
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

/** Anula una nota: queda marcada como anulada (no se borra ni se crea nota contraria)
 *  y deja de afectar el estado de cuenta. Devuelve el id de la misma nota. */
export async function anularNotaAjuste(
  proveedorId: string,
  notaId: string,
  motivo: string,
  llaveEdicion?: string
): Promise<{ id: string } | { error: string }> {
  try {
    return await apiFetch<{ id: string }>(`/api/proveedores/${proveedorId}/notas-ajuste/${notaId}/anular`, {
      method: 'POST',
      body: { motivo, llaveEdicion: llaveEdicion || undefined },
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo anular la nota.' };
  }
}
