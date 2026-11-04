import { apiFetch } from './api-client';
import { altaMaestroF4, fotosYaSubidas, provisionalesDeMaestro } from './maestros-cola';
import { offlineHabilitado } from '../lib/offline/sesion';
import type { FotoLocal } from '../lib/foto-picker';
import { obtenerCatalogo } from '../lib/offline/catalogos';
import type { Vehiculo } from '@shared/types/index.js';

export interface VehiculoInput {
  nombre: string;
  placa?: string | null;
  marca?: string | null;
  modelo?: string | null;
  color?: string | null;
  conductor?: string | null;
  descripcion?: string | null;
  fotos?: string[];
}

export async function obtenerVehiculos(): Promise<Vehiculo[]> {
  try {
    const { datos } = await obtenerCatalogo('vehiculos', async () => {
      const { vehiculos } = await apiFetch<{ vehiculos: Vehiculo[] }>('/api/vehiculos');
      return vehiculos;
    });
    return [...datos, ...(await provisionalesDeMaestro<Vehiculo>('vehiculo'))];
  } catch {
    return provisionalesDeMaestro<Vehiculo>('vehiculo');
  }
}

export async function crearVehiculo(input: VehiculoInput, fotosLocales?: FotoLocal[]): Promise<{ vehiculo: Vehiculo; enCola?: true } | { error: string }> {
  if (offlineHabilitado()) {
    const { fotos, ...datos } = input;
    const r = await altaMaestroF4<Vehiculo>('vehiculo', datos, fotosLocales ?? fotosYaSubidas(fotos));
    if ('error' in r) return r;
    return { vehiculo: r.entidad, ...(r.enCola ? { enCola: true as const } : {}) };
  }
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

export async function eliminarVehiculo(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/vehiculos/${id}`, { method: 'DELETE' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo eliminar el vehículo.' };
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
