import { apiFetch } from './api-client';
import type { RespuestaSaldos } from '@shared/types/saldos.js';

/** Saldos de todos los proveedores / clientes en una llamada (contrato: shared/types/saldos.ts).
 *  Misma cifra que `totales.saldo` del estado de cuenta. Falla con ApiError (503 si no se pudo calcular completo). */
export const listarSaldosProveedores = () => apiFetch<RespuestaSaldos>('/api/proveedores/saldos');
export const listarSaldosClientes = () => apiFetch<RespuestaSaldos>('/api/clientes/saldos');
