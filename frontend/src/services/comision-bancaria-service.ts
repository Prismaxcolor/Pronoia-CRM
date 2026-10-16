import { apiFetch } from './api-client';
import type { Movimiento } from '@shared/types/index.js';
import type { CrearMovimientoInput } from './banca-service';

export interface ConfigComisionBancaria {
  /** false mientras la migración de comisión bancaria no esté aplicada: el formulario no ofrece la opción. */
  disponible: boolean;
}

/**
 * ¿Se ofrece la comisión bancaria? Un fallo de red NO se disfraza de "no disponible": el backend exige la
 * elección Sí/No en las salidas desde Bs, así que el formulario debe saber que no pudo averiguarlo.
 */
export async function obtenerConfigComisionBancaria(): Promise<ConfigComisionBancaria | { error: string }> {
  try {
    const r = await apiFetch<{ disponible?: boolean }>('/api/cochinito/comision-bancaria');
    return { disponible: r.disponible === true };
  } catch {
    return { error: 'No se pudo verificar la comisión bancaria.' };
  }
}

export interface MovimientoRegistrado {
  movimiento: Movimiento;
  /** Cargo de comisión creado junto al movimiento; null si no lleva. */
  comision: { monto: number; movimientoId: string } | null;
  advertencia?: string;
}

/** Registra un movimiento y devuelve el motivo exacto si falla (saldo insuficiente con la comisión, migración pendiente...). */
export async function registrarMovimiento(input: CrearMovimientoInput): Promise<MovimientoRegistrado | { error: string }> {
  try {
    return await apiFetch<MovimientoRegistrado>('/api/cochinito/movimientos', { method: 'POST', body: input });
  } catch (err) {
    return { error: err instanceof Error && err.message ? err.message : 'No se pudo crear el movimiento. Verifica los datos e intenta de nuevo.' };
  }
}
