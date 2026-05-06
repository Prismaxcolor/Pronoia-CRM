import { apiFetch } from './api-client';
import type { Cliente } from '@shared/types/index.js';

interface ClienteApi {
  id: string;
  nombre: string;
  identificacion: string | null;
  email: string | null;
  telefono: string | null;
  direccion: string | null;
  notas: string | null;
  activo: boolean;
  creadoPor: string;
  creadoEn: string;
}

function mapApi(api: ClienteApi): Cliente {
  return { ...api };
}

export interface ClienteInput {
  nombre: string;
  identificacion?: string | null;
  email?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  notas?: string | null;
}

export async function obtenerClientes(): Promise<Cliente[]> {
  try {
    const { clientes } = await apiFetch<{ clientes: ClienteApi[] }>('/api/clientes');
    return clientes.map(mapApi);
  } catch {
    return [];
  }
}

export async function crearCliente(
  cliente: ClienteInput
): Promise<{ cliente: Cliente } | { error: string }> {
  try {
    const { cliente: creado } = await apiFetch<{ cliente: ClienteApi }>('/api/clientes', {
      method: 'POST',
      body: cliente,
    });
    return { cliente: mapApi(creado) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo crear el cliente.' };
  }
}

export async function actualizarCliente(
  id: string,
  cambios: Partial<ClienteInput> & { activo?: boolean }
): Promise<{ cliente: Cliente } | { error: string }> {
  try {
    const { cliente } = await apiFetch<{ cliente: ClienteApi }>(`/api/clientes/${id}`, {
      method: 'PATCH',
      body: cambios,
    });
    return { cliente: mapApi(cliente) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo actualizar el cliente.' };
  }
}

export async function desactivarCliente(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/clientes/${id}/desactivar`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo desactivar el cliente.' };
  }
}

export async function reactivarCliente(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/clientes/${id}/reactivar`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo reactivar el cliente.' };
  }
}

export async function borrarCliente(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/clientes/${id}`, { method: 'DELETE' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo borrar el cliente.' };
  }
}
