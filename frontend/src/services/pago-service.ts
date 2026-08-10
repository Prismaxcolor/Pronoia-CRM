import { apiFetch } from './api-client';

export interface RegistrarPagoInput {
  proveedorId: string;
  bancaId: string;
  /** En la moneda de la banca de origen. */
  monto: number;
  moneda: 'USD' | 'VES';
  /** Siempre en USD; es lo que se aplica a la factura y al estado de cuenta. */
  montoUsd: number;
  descripcion?: string | null;
  referencia?: string | null;
  fecha: string;
  /** Factura a la que se aplica el pago. Si se omite, es un adelanto. */
  facturaId?: string | null;
  /** URL del comprobante ya subido vía subirComprobantePago(). */
  comprobanteUrl?: string | null;
}

export async function registrarPago(
  input: RegistrarPagoInput
): Promise<{ movimientoId: string } | { error: string }> {
  try {
    const result = await apiFetch<{ movimientoId: string }>('/api/pagos', {
      method: 'POST',
      body: input,
    });
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo registrar el pago.' };
  }
}

export interface ItemPagoMultiple {
  tipo: 'factura' | 'nota_debito';
  id: string;
  /** Monto (USD) que se le aplica de este pago a este ítem. */
  montoUsd: number;
}

export interface RegistrarPagoMultipleInput {
  proveedorId: string;
  bancaId: string;
  monto: number;
  moneda: 'USD' | 'VES';
  montoUsd: number;
  descripcion?: string | null;
  referencia?: string | null;
  fecha: string;
  items: ItemPagoMultiple[];
  comprobanteUrl?: string | null;
}

/** "Pagar todo": un solo pago que liquida varias facturas y/o notas de
 *  débito, más un adelanto libre (montoUsd total menos la suma de los ítems). */
export async function registrarPagoMultiple(
  input: RegistrarPagoMultipleInput
): Promise<{ movimientoId: string } | { error: string }> {
  try {
    const result = await apiFetch<{ movimientoId: string }>('/api/pagos/multiple', {
      method: 'POST',
      body: input,
    });
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo registrar el pago.' };
  }
}
