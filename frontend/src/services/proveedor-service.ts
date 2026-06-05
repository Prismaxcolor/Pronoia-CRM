import { apiFetch } from './api-client';
import type { Proveedor } from '@shared/types/index.js';

interface ProveedorApi {
  id: string;
  nombre: string;
  rfc: string | null;
  telefono: string | null;
  email: string | null;
  activo: boolean;
  createdAt: string;
}

function mapApi(api: ProveedorApi): Proveedor {
  return { ...api };
}

export interface ProveedorInput {
  nombre: string;
  rfc?: string | null;
  telefono?: string | null;
  email?: string | null;
}

export async function obtenerProveedores(): Promise<Proveedor[]> {
  try {
    const { proveedores } = await apiFetch<{ proveedores: ProveedorApi[] }>('/api/proveedores');
    return proveedores.map(mapApi);
  } catch {
    return [];
  }
}

export async function crearProveedor(
  proveedor: ProveedorInput
): Promise<{ proveedor: Proveedor } | { error: string }> {
  try {
    const { proveedor: creado } = await apiFetch<{ proveedor: ProveedorApi }>('/api/proveedores', {
      method: 'POST',
      body: proveedor,
    });
    return { proveedor: mapApi(creado) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo crear el proveedor.' };
  }
}

export async function actualizarProveedor(
  id: string,
  cambios: Partial<ProveedorInput> & { activo?: boolean }
): Promise<{ proveedor: Proveedor } | { error: string }> {
  try {
    const { proveedor } = await apiFetch<{ proveedor: ProveedorApi }>(`/api/proveedores/${id}`, {
      method: 'PATCH',
      body: cambios,
    });
    return { proveedor: mapApi(proveedor) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo actualizar el proveedor.' };
  }
}

export async function desactivarProveedor(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/proveedores/${id}/desactivar`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo desactivar el proveedor.' };
  }
}

export async function reactivarProveedor(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/proveedores/${id}/reactivar`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo reactivar el proveedor.' };
  }
}

export async function borrarProveedor(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/proveedores/${id}`, { method: 'DELETE' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo borrar el proveedor.' };
  }
}
