import { leerGet } from './lectura-service';
import type { RespuestaSaldos } from '@shared/types/saldos.js';

/** Saldos de todos los proveedores / clientes en una llamada (contrato: shared/types/saldos.ts).
 *  Misma cifra que `totales.saldo` del estado de cuenta. Falla con ApiError (503 si no se pudo calcular completo). */
export const listarSaldosProveedores = () => leerGet<RespuestaSaldos>('/api/proveedores/saldos');
export const listarSaldosClientes = () => leerGet<RespuestaSaldos>('/api/clientes/saldos');
