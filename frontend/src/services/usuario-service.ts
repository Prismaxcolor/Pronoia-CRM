import { apiFetch } from './api-client';
import type { Usuario, Permiso, RolUsuario } from '@shared/types/index.js';
import { PERMISOS_POR_ROL } from '@shared/types/index.js';

interface UsuarioApi {
  id: string;
  email: string;
  nombre: string;
  rol: RolUsuario;
  permisos: Permiso[] | null;
  activo: boolean;
  creadoEn: string;
}

function mapApi(api: UsuarioApi): Usuario {
  const permisos = api.permisos && api.permisos.length > 0
    ? api.permisos
    : PERMISOS_POR_ROL[api.rol] ?? [];
  return {
    id: api.id,
    authId: api.id,
    nombre: api.nombre,
    email: api.email,
    rol: api.rol,
    permisos,
    activo: api.activo,
    creadoEn: api.creadoEn,
  };
}

export async function obtenerUsuarios(): Promise<Usuario[]> {
  try {
    const { usuarios } = await apiFetch<{ usuarios: UsuarioApi[] }>('/api/usuarios');
    return usuarios.map(mapApi);
  } catch {
    return [];
  }
}

export async function crearUsuario(
  email: string,
  password: string,
  nombre: string,
  rol: RolUsuario
): Promise<{ usuario: Usuario } | { error: string }> {
  try {
    const { usuario } = await apiFetch<{ usuario: UsuarioApi }>('/api/usuarios', {
      method: 'POST',
      body: { email, password, nombre, rol },
    });
    return { usuario: mapApi(usuario) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo crear el usuario.' };
  }
}

export interface ActualizarUsuarioCambios {
  nombre?: string;
  rol?: RolUsuario;
  permisos?: Permiso[];
  activo?: boolean;
}

export async function actualizarUsuario(
  id: string,
  cambios: ActualizarUsuarioCambios
): Promise<{ usuario: Usuario } | { error: string }> {
  try {
    const { usuario } = await apiFetch<{ usuario: UsuarioApi }>(`/api/usuarios/${id}`, {
      method: 'PATCH',
      body: cambios,
    });
    return { usuario: mapApi(usuario) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo actualizar el usuario.' };
  }
}

export async function desactivarUsuario(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/usuarios/${id}/desactivar`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo desactivar el usuario.' };
  }
}

export async function reactivarUsuario(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/usuarios/${id}/reactivar`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo reactivar el usuario.' };
  }
}

export async function borrarUsuario(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/usuarios/${id}`, { method: 'DELETE' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo borrar el usuario.' };
  }
}
