import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../config/supabase.js';
import type { CrearUsuarioInput, ActualizarUsuarioInput } from '../schemas/usuarios.js';
import { validarEdicionUsuario, validarPrivilegiosEdicion } from '../utils/usuario-reglas.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import { normalizarTemaMarca, type TemaMarca } from '../utils/tema-marca.js';

const BCRYPT_ROUNDS = 10;

const COLUMNAS_BASE = 'id, email, nombre, rol, permisos, activo, creado_en';
/** tema_marca llega con migration_usuarios_tema_marca.sql; antes no existe. */
const COLUMNAS_CON_TEMA = `${COLUMNAS_BASE}, tema_marca`;

interface UsuarioRow {
  id: string;
  email: string;
  nombre: string;
  rol: 'superadmin' | 'administracion' | 'trabajador';
  permisos: unknown;
  activo: boolean;
  creado_en: string;
  tema_marca?: unknown;
}

export interface UsuarioPublico {
  id: string;
  email: string;
  nombre: string;
  rol: UsuarioRow['rol'];
  permisos: unknown;
  activo: boolean;
  creadoEn: string;
  temaMarca: TemaMarca | null;
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
    temaMarca: normalizarTemaMarca(row.tema_marca),
  };
}

export async function listarUsuarios(): Promise<UsuarioPublico[]> {
  const conTema = await supabaseAdmin
    .from('users')
    .select(COLUMNAS_CON_TEMA)
    .order('creado_en', { ascending: false });

  // Migración de tema_marca aún sin aplicar: se degrada a la lista sin esa columna.
  const { data, error } = esObjetoInexistente(conTema.error)
    ? await supabaseAdmin.from('users').select(COLUMNAS_BASE).order('creado_en', { ascending: false })
    : conTema;

  if (error || !data) return [];
  return (data as unknown as UsuarioRow[]).map(toPublico);
}

async function leerUsuarioPublico(id: string): Promise<UsuarioPublico | null> {
  const conTema = await supabaseAdmin.from('users').select(COLUMNAS_CON_TEMA).eq('id', id).maybeSingle();
  const data = conTema.data
    ?? (await supabaseAdmin.from('users').select(COLUMNAS_BASE).eq('id', id).maybeSingle()).data;
  return data ? toPublico(data as unknown as UsuarioRow) : null;
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
    .select(COLUMNAS_BASE)
    .single();

  if (error || !data) return { error: error?.message ?? 'No se pudo crear el usuario.' };
  return { usuario: toPublico(data as unknown as UsuarioRow) };
}

/**
 * Un superadmin tiene acceso total sin importar lo que diga permisos (el
 * middleware lo bypassea siempre) — pero si al usuario le quedó un array de
 * permisos personalizados de cuando tenía otro rol (ej. trabajador con solo
 * 5 permisos), la tabla de Usuarios muestra ese conteo viejo y da la
 * impresión de que un superadmin tiene MENOS permisos que un trabajador con
 * permisos personalizados amplios. Se limpia acá, al promoverlo, para que
 * nunca quede un array viejo pegado. Función pura: no toca la BD, así se
 * puede testear sin mocks.
 */
export function normalizarCambiosRol(cambios: ActualizarUsuarioInput): ActualizarUsuarioInput {
  if (cambios.rol !== 'superadmin') return cambios;
  return { ...cambios, permisos: [] };
}

export type ActualizarUsuarioResult =
  | { usuario: UsuarioPublico }
  | { error: string; status: number };

/**
 * Edición completa de un usuario por un administrador. La autenticación es
 * propia (tabla users + bcrypt), no Supabase Auth, así que el correo solo
 * vive en users. Valida reglas de negocio, unicidad de correo y hashea la
 * contraseña si se restablece.
 */
export async function actualizarUsuarioAdmin(
  actorId: string,
  id: string,
  cambios: ActualizarUsuarioInput
): Promise<ActualizarUsuarioResult> {
  const { data: target, error: errTarget } = await supabaseAdmin
    .from('users')
    .select('id, rol, activo')
    .eq('id', id)
    .maybeSingle();
  if (errTarget) return { error: 'No se pudo consultar el usuario.', status: 500 };
  if (!target) return { error: 'Usuario no encontrado.', status: 404 };

  const { data: actor, error: errActor } = await supabaseAdmin
    .from('users')
    .select('rol, activo')
    .eq('id', actorId)
    .maybeSingle();
  if (errActor) return { error: 'No se pudo verificar al usuario que edita.', status: 500 };

  const errorPrivilegios = validarPrivilegiosEdicion({
    actor: actor ? { rol: actor.rol as UsuarioRow['rol'], activo: Boolean(actor.activo) } : null,
    actorId,
    targetId: id,
    targetRol: target.rol as UsuarioRow['rol'],
    cambios,
  });
  if (errorPrivilegios) return errorPrivilegios;

  const { count: superadminsActivos, error: errCount } = await supabaseAdmin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('rol', 'superadmin')
    .eq('activo', true);
  if (errCount) return { error: 'No se pudo verificar los superadmins.', status: 500 };

  const errorRegla = validarEdicionUsuario({
    actorId,
    targetId: id,
    target: { rol: target.rol as UsuarioRow['rol'], activo: target.activo as boolean },
    cambios,
    superadminsActivos: superadminsActivos ?? 0,
  });
  if (errorRegla) return { error: errorRegla, status: 400 };

  if (cambios.email) {
    const { data: duplicado } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', cambios.email)
      .neq('id', id)
      .maybeSingle();
    if (duplicado) return { error: 'Ya existe otro usuario con ese email.', status: 409 };
  }

  const { password, temaMarca, ...resto } = normalizarCambiosRol(cambios);
  const update: Record<string, unknown> = { ...resto };
  if (temaMarca !== undefined) update.tema_marca = temaMarca;
  if (password) update.password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const { data, error } = await supabaseAdmin
    .from('users')
    .update(update)
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error && temaMarca !== undefined && esObjetoInexistente(error)) {
    return {
      error: 'El color del sistema aún no está habilitado en la base de datos (falta aplicar migration_usuarios_tema_marca.sql).',
      status: 409,
    };
  }
  if (error) {
    const esDuplicado = error.code === '23505';
    return {
      error: esDuplicado ? 'Ya existe otro usuario con ese email.' : 'No se pudo actualizar el usuario.',
      status: esDuplicado ? 409 : 500,
    };
  }
  if (!data) return { error: 'Usuario no encontrado.', status: 404 };
  const usuario = await leerUsuarioPublico(id);
  if (!usuario) return { error: 'Usuario no encontrado.', status: 404 };
  return { usuario };
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
