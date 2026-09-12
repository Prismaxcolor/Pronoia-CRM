import { apiFetch } from './api-client';
import type { Vehiculo } from '@shared/types/index.js';

export interface VehiculoInput {
  nombre: string;
}

export async function obtenerVehiculos(): Promise<Vehiculo[]> {
  try {
    const { vehiculos } = await apiFetch<{ vehiculos: Vehiculo[] }>('/api/vehiculos');
    return vehiculos;
  } catch {
    return [];
  }
}

export async function crearVehiculo(input: VehiculoInput): Promise<{ vehiculo: Vehiculo } | { error: string }> {
  try {
    const { vehiculo } = await apiFetch<{ vehiculo: Vehiculo }>('/api/vehiculos', {
      method: 'POST',
      body: input,
    });
    return { vehiculo };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo crear el vehículo.' };
  }
}

export async function actualizarVehiculo(
  id: string,
  cambios: Partial<VehiculoInput> & { activo?: boolean }
): Promise<{ vehiculo: Vehiculo } | { error: string }> {
  try {
    const { vehiculo } = await apiFetch<{ vehiculo: Vehiculo }>(`/api/vehiculos/${id}`, {
      method: 'PATCH',
      body: cambios,
    });
    return { vehiculo };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo actualizar el vehículo.' };
  }
}

export async function desactivarVehiculo(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/vehiculos/${id}/desactivar`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo desactivar el vehículo.' };
  }
}

export async function reactivarVehiculo(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/vehiculos/${id}/reactivar`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo reactivar el vehículo.' };
  }
}
