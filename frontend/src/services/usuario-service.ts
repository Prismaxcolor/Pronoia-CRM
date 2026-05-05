import { supabase } from '../config/supabase';
import type { Usuario, Permiso, RolUsuario } from '@shared/types/index.js';
import { PERMISOS_POR_ROL } from '@shared/types/index.js';

function mapRow(row: Record<string, unknown>): Usuario {
  const rol = row.rol as RolUsuario;
  const permisosCustom = row.permisos as Permiso[] | null;
  const permisos = permisosCustom && permisosCustom.length > 0
    ? permisosCustom
    : PERMISOS_POR_ROL[rol] ?? [];

  return {
    id: row.id as string,
    authId: row.id as string,
    nombre: row.nombre as string,
    email: row.email as string,
    rol,
    permisos,
    activo: row.activo as boolean,
    creadoEn: row.creado_en as string,
  };
}

export async function obtenerUsuarios(): Promise<Usuario[]> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('creado_en', { ascending: false });

  if (error || !data) return [];
  return data.map(mapRow);
}

export async function crearUsuario(email: string, password: string, nombre: string, rol: RolUsuario): Promise<Usuario | null> {
  const { data, error } = await supabase.rpc('create_user', {
    p_email: email,
    p_password: password,
    p_nombre: nombre,
  });

  if (error || !data || data.length === 0) return null;

  // Actualizar rol si no es trabajador (el default)
  if (rol !== 'trabajador') {
    await supabase.from('users').update({ rol }).eq('id', data[0].id);
  }

  return mapRow({ ...data[0], rol });
}

export async function actualizarUsuario(id: string, campos: { rol?: RolUsuario; permisos?: Permiso[]; activo?: boolean; nombre?: string }): Promise<boolean> {
  const { error } = await supabase
    .from('users')
    .update(campos)
    .eq('id', id);

  return !error;
}

export async function eliminarUsuario(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('users')
    .update({ activo: false })
    .eq('id', id);

  return !error;
}
