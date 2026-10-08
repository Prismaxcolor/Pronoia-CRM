import { apiFetch } from './api-client';
import { altaMaestroF4, fotosYaSubidas, provisionalesDeMaestro } from './maestros-cola';
import { offlineHabilitado } from '../lib/offline/sesion';
import type { FotoLocal } from '../lib/foto-picker';
import { obtenerCatalogo } from '../lib/offline/catalogos';
import type { Proveedor } from '@shared/types/index.js';

interface ProveedorApi {
  id: string;
  nombre: string;
  rfc: string | null;
  telefono: string | null;
  email: string | null;
  activo: boolean;
  createdAt: string;
  fotos: string[];
  telegramChatId: string | null;
  telegramLinkedAt: string | null;
}

function mapApi(api: ProveedorApi): Proveedor {
  return { ...api };
}

export interface ProveedorInput {
  nombre: string;
  rfc?: string | null;
  telefono?: string | null;
  email?: string | null;
  fotos?: string[];
}

export async function obtenerProveedores(): Promise<Proveedor[]> {
  try {
    const { datos } = await obtenerCatalogo('proveedores', async () => {
      const { proveedores } = await apiFetch<{ proveedores: ProveedorApi[] }>('/api/proveedores');
      return proveedores.map(mapApi);
    });
    return [...datos, ...(await provisionalesDeMaestro<Proveedor>('proveedor'))];
  } catch {
    return provisionalesDeMaestro<Proveedor>('proveedor');
  }
}

export async function crearProveedor(
  proveedor: ProveedorInput,
  fotosLocales?: FotoLocal[]
): Promise<{ proveedor: Proveedor; enCola?: true } | { error: string }> {
  if (offlineHabilitado()) {
    const { fotos, ...datos } = proveedor;
    const r = await altaMaestroF4<ProveedorApi>('proveedor', datos, fotosLocales ?? fotosYaSubidas(fotos));
    if ('error' in r) return r;
    return { proveedor: mapApi(r.entidad), ...(r.enCola ? { enCola: true as const } : {}) };
  }
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

export async function generarLinkTelegramProveedor(
  id: string
): Promise<{ deepLink: string } | { error: string }> {
  try {
    return await apiFetch<{ deepLink: string }>(`/api/proveedores/${id}/telegram/generar-link`, {
      method: 'POST',
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo generar el link de Telegram.' };
  }
}
