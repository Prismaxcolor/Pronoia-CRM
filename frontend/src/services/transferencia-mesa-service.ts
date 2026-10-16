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
  /** Ya estaba cobrada por completo: esta llamada no acreditó nada. */
  yaCompletada: boolean;
  /** true si tras este cobro no queda pendiente. */
  completada: boolean;
  /** Acreditado al destino en esta llamada y totales (moneda destino, neto de comisión). */
  montoAcreditado: number;
  montoCobrado: number;
  montoPendiente: number;
  /** El cobro quedó hecho pero algo secundario falló (p. ej. adjuntar la foto). */
  advertencia?: string;
}

/** Cuerpo de POST /api/cochinito/movimientos/:id/completar. Sin opciones se cobra todo lo pendiente, sin foto. */
export interface OpcionesCobroMesa {
  /** Neto a cobrar ahora; null/omitido = todo lo pendiente (cobro parcial si es menor). */
  montoCobrado?: number | null;
  /** Pendiente que vio el usuario: si cambió (otro cobro, doble clic) el servidor rechaza. */
  pendienteEsperado?: number | null;
  /** URLs de la foto del cobro, ya subidas. */
  comprobantes?: string[];
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

/** Acredita (todo o una parte de) lo pendiente en la cuenta destino, neto de comisión. Repetir un cobro total no vuelve a acreditar. */
export async function completarTransferenciaMesa(id: string, opciones: OpcionesCobroMesa = {}): Promise<TransferenciaMesaCompletada | { error: string }> {
  try {
    return await apiFetch<TransferenciaMesaCompletada>(`/api/cochinito/movimientos/${id}/completar`, { method: 'POST', body: opciones });
  } catch (err) {
    return { error: mensaje(err, 'No se pudo completar la transferencia.') };
  }
}
