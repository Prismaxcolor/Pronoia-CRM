import { apiFetch } from './api-client';
import type { CategoriaWallet } from '@shared/types/index.js';
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
  /** Categoría del Wallet (venta de chatarra NF / PCB): obligatoria si el cobro mueve dinero y hay categorías configuradas. */
  categoriaId?: string | null;
}

export interface ResultadoCobroMultiple {
  /** Null en un cruce puro: no hay movimiento de dinero. */
  movimientoPrincipalId: string | null;
  movimientoIds: string[];
  grupoId: string;
  numeroCobro: number | null;
  numeroAnticipo: number | null;
  /** Correlativo CRV- si la operación fue un cruce puro. */
  numeroCruce: number | null;
  /** Categoría aplicada a los movimientos de dinero; null si no hay categorías configuradas o fue un cruce puro. */
  categoriaId?: string | null;
  /** Presente si el cobro quedó registrado pero no se pudo asignar la categoría. */
  advertencia?: string;
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

/** Categorías entre las que se elige al cobrar a un cliente. Lista vacía = el cobro no pide categoría. */
export async function obtenerCategoriasCobro(): Promise<{ categorias: CategoriaWallet[] } | { error: string }> {
  try {
    return await apiFetch<{ categorias: CategoriaWallet[] }>('/api/cobros/categorias');
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudieron cargar las categorías del cobro.' };
  }
}
