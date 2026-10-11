import { apiFetch } from './api-client';
import type { Movimiento } from '@shared/types/index.js';

/** Cuerpo de POST /api/cochinito/movimientos/mesa-cambio (ver features/cochinito/transferencia-mesa.ts). */
export interface CrearTransferenciaMesaInput {
  cambistaId: string;
  bancaId: string;
  bancaDestinoId: string;
  monto: number;
  montoDestino: number | null;
  montoUsd: number | null;
  comision: { modo: 'porcentaje' | 'monto'; valor: number } | null;
  descripcion: string;
  referencia: string;
  fecha: string;
  comprobantes: string[];
  /** UUID del intento: hace seguros los reintentos y el doble clic (el servidor no duplica la transferencia). */
  clientRequestId?: string;
}

export interface TransferenciaMesaCreada {
  movimiento: Movimiento;
  asientoNumero: number;
  montoUsd: number;
  comision: number;
  montoNeto: number;
  advertencia?: string;
}

export interface TransferenciaMesaCompletada {
  movimiento: Movimiento;
  yaCompletada: boolean;
  montoAcreditado: number;
}

const mensaje = (err: unknown, respaldo: string): string => (err instanceof Error && err.message ? err.message : respaldo);

/** Crea la transferencia EN PROCESO: descuenta el origen, el destino no recibe saldo hasta completarla. */
export async function crearTransferenciaMesa(input: CrearTransferenciaMesaInput): Promise<{ transferencia: TransferenciaMesaCreada } | { error: string }> {
  try {
    return await apiFetch<{ transferencia: TransferenciaMesaCreada }>('/api/cochinito/movimientos/mesa-cambio', { method: 'POST', body: input });
  } catch (err) {
    return { error: mensaje(err, 'No se pudo registrar la transferencia con mesa de cambio.') };
  }
}

/** Acredita el saldo en la cuenta destino (neto de comisión). Repetirla no vuelve a acreditar. */
export async function completarTransferenciaMesa(id: string): Promise<TransferenciaMesaCompletada | { error: string }> {
  try {
    return await apiFetch<TransferenciaMesaCompletada>(`/api/cochinito/movimientos/${id}/completar`, { method: 'POST', body: {} });
  } catch (err) {
    return { error: mensaje(err, 'No se pudo completar la transferencia.') };
  }
}
