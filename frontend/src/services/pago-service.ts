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

export interface BancaPago {
  bancaId: string;
  /** En la moneda propia de esa banca. */
  monto: number;
  moneda: 'USD' | 'VES';
  montoUsd: number;
  /** Referencia propia de esta banca (ej. número de transferencia). */
  referencia?: string | null;
}

export interface RegistrarPagoMultipleInput {
  proveedorId: string;
  bancas: BancaPago[];
  /** Total a pagar (USD) — puede superar la suma de los ítems, el excedente
   *  se registra como adelanto aparte. */
  montoUsd: number;
  descripcion?: string | null;
  referencia?: string | null;
  fecha: string;
  items: ItemPagoMultiple[];
  comprobanteUrl?: string | null;
}

export interface ResultadoPagoMultiple {
  movimientoPrincipalId: string;
  movimientoIds: string[];
  grupoId: string;
  numeroPago: number | null;
  numeroAdelanto: number | null;
}

/** "Registrar pago": una o varias bancas de origen, liquida varias facturas
 *  y/o notas de débito, y el excedente sobre esos ítems queda como adelanto
 *  en un movimiento aparte (lo separa el backend). */
export async function registrarPagoMultiple(
  input: RegistrarPagoMultipleInput
): Promise<ResultadoPagoMultiple | { error: string }> {
  try {
    const result = await apiFetch<ResultadoPagoMultiple>('/api/pagos/multiple', {
      method: 'POST',
      body: input,
    });
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo registrar el pago.' };
  }
}
