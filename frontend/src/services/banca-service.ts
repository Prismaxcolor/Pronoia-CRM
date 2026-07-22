import { apiFetch } from './api-client';
import type { Banca, Movimiento, TipoBanca } from '@shared/types/index.js';

export interface ObtenerBancasOpts {
  incluirArchivadas?: boolean;
}

export async function obtenerBancas(opts: ObtenerBancasOpts = {}): Promise<Banca[]> {
  try {
    const query = opts.incluirArchivadas ? '?incluirArchivadas=true' : '';
    const { bancas } = await apiFetch<{ bancas: Banca[] }>(`/api/cochinito/bancas${query}`);
    return bancas;
  } catch {
    return [];
  }
}

export async function obtenerMovimientos(): Promise<Movimiento[]> {
  try {
    const { movimientos } = await apiFetch<{ movimientos: Movimiento[] }>('/api/cochinito/movimientos');
    return movimientos;
  } catch {
    return [];
  }
}

export interface CrearBancaInput {
  nombre: string;
  tipo: TipoBanca;
  moneda: string;
  descripcion: string;
}

/** Crea una banca con saldo 0. Para establecer saldo inicial se debe registrar un ingreso. */
export async function crearBanca(input: CrearBancaInput): Promise<Banca | null> {
  try {
    const { banca } = await apiFetch<{ banca: Banca }>('/api/cochinito/bancas', {
      method: 'POST',
      body: input,
    });
    return banca;
  } catch (err) {
    console.error('Error al crear banca:', err);
    return null;
  }
}

export interface ActualizarBancaInput {
  nombre?: string;
  tipo?: TipoBanca;
  descripcion?: string;
}

export async function actualizarBanca(id: string, campos: ActualizarBancaInput): Promise<boolean> {
  try {
    await apiFetch(`/api/cochinito/bancas/${id}`, { method: 'PATCH', body: campos });
    return true;
  } catch {
    return false;
  }
}

export interface ArchivarBancaResult {
  ok: boolean;
  razon?: string;
}

/**
 * Archiva una banca (soft delete). Falla si tiene saldo distinto de 0.
 * No se permite borrar físicamente: la regla de dominio del CLAUDE.md es
 * "en finanzas NUNCA se borra; se reversa con un movimiento contrario".
 */
export async function archivarBanca(id: string): Promise<ArchivarBancaResult> {
  try {
    await apiFetch(`/api/cochinito/bancas/${id}/archivar`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    return { ok: false, razon: err instanceof Error ? err.message : 'No se pudo archivar la banca.' };
  }
}

export async function desarchivarBanca(id: string): Promise<boolean> {
  try {
    await apiFetch(`/api/cochinito/bancas/${id}/desarchivar`, { method: 'POST' });
    return true;
  } catch {
    return false;
  }
}

export interface CrearMovimientoInput {
  tipo: 'ingreso' | 'egreso';
  bancaId: string;
  monto: number;
  moneda: string;
  descripcion: string;
  referencia: string;
  fecha: string;
  registradoPor: string;
  /** Proveedor al que se le paga (egreso). Alimenta su estado de cuenta. */
  proveedorId?: string | null;
  /** Cliente del que se cobra (ingreso). Alimenta su estado de cuenta. */
  clienteId?: string | null;
}

/** Crea un movimiento de ingreso o egreso. El trigger SQL ajusta el saldo. */
export async function crearMovimiento(input: CrearMovimientoInput): Promise<Movimiento | null> {
  try {
    const { movimiento } = await apiFetch<{ movimiento: Movimiento }>('/api/cochinito/movimientos', {
      method: 'POST',
      body: input,
    });
    return movimiento;
  } catch (err) {
    console.error('Error al crear movimiento:', err);
    return null;
  }
}
