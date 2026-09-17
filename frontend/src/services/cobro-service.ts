import { apiFetch } from './api-client';
import type { ItemPagoMultiple, BancaPago } from './pago-service';

/** Espejo de pago-service.ts (registrarPagoMultiple) para cobros a cliente —
 *  apunta a /api/cobros/multiple en vez de /api/pagos/multiple. */

export interface RegistrarCobroMultipleInput {
  clienteId: string;
  bancas: BancaPago[];
  /** Total a cobrar (USD) — puede superar la suma de los ítems, el excedente
   *  se registra como anticipo aparte. */
  montoUsd: number;
  descripcion?: string | null;
  referencia?: string | null;
  fecha: string;
  items: ItemPagoMultiple[];
  comprobantes?: string[];
}

export interface ResultadoCobroMultiple {
  movimientoPrincipalId: string;
  movimientoIds: string[];
  grupoId: string;
  numeroCobro: number | null;
  numeroAnticipo: number | null;
}

/** "Registrar cobro": una o varias bancas de destino, liquida varias
 *  facturas de venta y/o notas de débito, y el excedente sobre esos ítems
 *  queda como anticipo en un movimiento aparte (lo separa el backend). */
export async function registrarCobroMultiple(
  input: RegistrarCobroMultipleInput
): Promise<ResultadoCobroMultiple | { error: string }> {
  try {
    const result = await apiFetch<ResultadoCobroMultiple>('/api/cobros/multiple', {
      method: 'POST',
      body: input,
    });
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo registrar el cobro.' };
  }
}
