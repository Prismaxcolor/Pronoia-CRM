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
  /** URLs de los comprobantes ya subidos vía subirComprobantePago(). */
  comprobantes?: string[];
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
  /** 'adelanto' = adelanto/anticipo con saldo sin aplicar (su `id` es el adelanto_id
   *  de obtenerAdelantosDisponibles); resta como una nota de crédito. */
  tipo: 'factura' | 'nota_debito' | 'nota_credito' | 'adelanto';
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
  /** Total a pagar en efectivo/banco (USD) — puede superar lo que resta de los
   *  ítems (el excedente se registra como adelanto aparte) y puede ser 0: cruce
   *  puro, con `bancas` vacío y sin movimiento de dinero. */
  montoUsd: number;
  descripcion?: string | null;
  referencia?: string | null;
  fecha: string;
  items: ItemPagoMultiple[];
  comprobantes?: string[];
}

export interface ResultadoPagoMultiple {
  /** Null en un cruce puro: no hay movimiento de dinero. */
  movimientoPrincipalId: string | null;
  movimientoIds: string[];
  grupoId: string;
  numeroPago: number | null;
  numeroAdelanto: number | null;
  /** Correlativo CR- si la operación fue un cruce puro. */
  numeroCruce: number | null;
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
