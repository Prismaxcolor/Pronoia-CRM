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
  temaMarca?: 'azul' | null;
  telegramVinculado?: boolean;
  telegramLinkedAt?: string | null;
  telegramChatId?: string | null;
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
    temaMarca: api.temaMarca === 'azul' ? 'azul' : null,
    telegramVinculado: Boolean(api.telegramVinculado),
    telegramLinkedAt: api.telegramLinkedAt ?? null,
    telegramChatId: api.telegramChatId ?? null,
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
  email?: string;
  password?: string;
  nombre?: string;
  rol?: RolUsuario;
  permisos?: Permiso[];
  activo?: boolean;
  temaMarca?: 'azul' | null;
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

export interface LinkTelegramUsuario {
  deepLink: string;
  /** True cuando un superadmin genera el enlace de otra persona: ELLA debe abrirlo. */
  paraOtraPersona: boolean;
  aviso?: string;
}

/** `'me'` = el propio usuario; cualquier otro valor es un id (solo superadmin). */
async function generarLinkTelegramDe(objetivo: string): Promise<LinkTelegramUsuario | { error: string }> {
  try {
    return await apiFetch<LinkTelegramUsuario>(`/api/usuarios/${objetivo}/telegram/generar-link`, { method: 'POST' });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo generar el enlace de Telegram.' };
  }
}

async function desvincularTelegramDe(objetivo: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/usuarios/${objetivo}/telegram`, { method: 'DELETE' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo desvincular el Telegram.' };
  }
}

export const generarLinkTelegramMe = () => generarLinkTelegramDe('me');
export const desvincularTelegramMe = () => desvincularTelegramDe('me');
export const generarLinkTelegramUsuario = (id: string) => generarLinkTelegramDe(id);
export const desvincularTelegramUsuario = (id: string) => desvincularTelegramDe(id);

/** Estado de Telegram de un usuario (superadmin ve a cualquiera por la lista de usuarios). */
export async function leerTelegramUsuario(id: string): Promise<{ vinculado: boolean; linkedAt: string | null } | null> {
  const usuario = (await obtenerUsuarios()).find(u => u.id === id);
  return usuario ? { vinculado: Boolean(usuario.telegramVinculado), linkedAt: usuario.telegramLinkedAt ?? null } : null;
}

/** Estado de Telegram del usuario autenticado (relee /api/auth/me). */
export async function leerTelegramMe(): Promise<{ vinculado: boolean; linkedAt: string | null } | null> {
  try {
    const { usuario } = await apiFetch<{ usuario: UsuarioApi }>('/api/auth/me');
    return { vinculado: Boolean(usuario.telegramVinculado), linkedAt: usuario.telegramLinkedAt ?? null };
  } catch {
    return null;
  }
}

/** Ids de las cuentas/cajas a las que el usuario tiene acceso asignado (solo el superadmin ve todas sin asignar). */
export async function obtenerBancasDeUsuario(id: string): Promise<{ bancaIds: string[] } | { error: string }> {
  try {
    return await apiFetch<{ bancaIds: string[] }>(`/api/usuarios/${id}/bancas`);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo leer el acceso a cuentas.' };
  }
}

/** Reemplaza las cuentas/cajas a las que el usuario tiene acceso. */
export async function guardarBancasDeUsuario(id: string, bancaIds: string[]): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/usuarios/${id}/bancas`, { method: 'PUT', body: { bancaIds } });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo guardar el acceso a cuentas.' };
  }
}
