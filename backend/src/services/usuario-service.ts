import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../config/supabase.js';
import type { CrearUsuarioInput, ActualizarUsuarioInput } from '../schemas/usuarios.js';

const BCRYPT_ROUNDS = 10;

interface UsuarioRow {
  id: string;
  email: string;
  nombre: string;
  rol: 'superadmin' | 'administracion' | 'trabajador';
  permisos: unknown;
  activo: boolean;
  creado_en: string;
}

export interface UsuarioPublico {
  id: string;
  email: string;
  nombre: string;
  rol: UsuarioRow['rol'];
  permisos: unknown;
  activo: boolean;
  creadoEn: string;
}

function toPublico(row: UsuarioRow): UsuarioPublico {
  return {
    id: row.id,
    email: row.email,
    nombre: row.nombre,
    rol: row.rol,
    permisos: row.permisos,
    activo: row.activo,
    creadoEn: row.creado_en,
  };
}

export async function listarUsuarios(): Promise<UsuarioPublico[]> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, email, nombre, rol, permisos, activo, creado_en')
    .order('creado_en', { ascending: false });

  if (error || !data) return [];
  return (data as UsuarioRow[]).map(toPublico);
}

export async function crearUsuarioAdmin(
  input: CrearUsuarioInput
): Promise<{ usuario: UsuarioPublico } | { error: string }> {
  const { data: existente } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', input.email)
    .maybeSingle();

  if (existente) return { error: 'Ya existe un usuario con ese email.' };

  const password_hash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const { data, error } = await supabaseAdmin
    .from('users')
    .insert({
      email: input.email,
      nombre: input.nombre,
      password_hash,
      rol: input.rol,
      activo: true,
    })
    .select('id, email, nombre, rol, permisos, activo, creado_en')
    .single();

  if (error || !data) return { error: error?.message ?? 'No se pudo crear el usuario.' };
  return { usuario: toPublico(data as UsuarioRow) };
}

export async function actualizarUsuarioAdmin(
  id: string,
  cambios: ActualizarUsuarioInput
): Promise<{ usuario: UsuarioPublico } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .update(cambios)
    .eq('id', id)
    .select('id, email, nombre, rol, permisos, activo, creado_en')
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: 'Usuario no encontrado.' };
  return { usuario: toPublico(data as UsuarioRow) };
}

/** Soft delete: marca activo = false. Nunca borra físicamente. */
export async function desactivarUsuario(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('users')
    .update({ activo: false })
    .eq('id', id);
  return !error;
}

export async function reactivarUsuario(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('users')
    .update({ activo: true })
    .eq('id', id);
  return !error;
}

export interface BorrarUsuarioResult {
  ok: boolean;
  razon?: string;
  referencias?: { movimientos: number; facturas: number };
}

/**
 * Borrado físico. Solo permitido si el usuario no tiene movimientos ni
 * facturas creadas — para no romper integridad referencial ni perder
 * trazabilidad de operaciones financieras (regla de auditoría del CLAUDE.md).
 *
 * Para usuarios con historial financiero, usar desactivarUsuario.
 */
export async function borrarUsuario(id: string): Promise<BorrarUsuarioResult> {
  const [{ count: movs }, { count: facts }] = await Promise.all([
    supabaseAdmin
      .from('movimientos')
      .select('id', { count: 'exact', head: true })
      .eq('registrado_por', id),
    supabaseAdmin
      .from('facturas')
      .select('id', { count: 'exact', head: true })
      .eq('creado_por', id),
  ]);

  const movimientos = movs ?? 0;
  const facturas = facts ?? 0;

  if (movimientos > 0 || facturas > 0) {
    return {
      ok: false,
      razon: 'El usuario tiene historial financiero y no se puede borrar. Mantenlo desactivado para preservar la auditoría.',
      referencias: { movimientos, facturas },
    };
  }

  const { error } = await supabaseAdmin.from('users').delete().eq('id', id);
  if (error) return { ok: false, razon: error.message };
  return { ok: true };
}
