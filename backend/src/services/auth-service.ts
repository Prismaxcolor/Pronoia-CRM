import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '../config/supabase.js';
import { ENV } from '../config/env.js';

const TOKEN_EXPIRY = '7d';
const BCRYPT_ROUNDS = 10;

export interface UsuarioRow {
  id: string;
  email: string;
  nombre: string;
  rol: 'superadmin' | 'administracion' | 'trabajador';
  permisos: unknown;
  activo: boolean;
  password_hash: string;
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

export interface JwtPayload {
  sub: string;
  email: string;
  rol: UsuarioRow['rol'];
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

function firmarToken(usuario: UsuarioRow): string {
  const payload: JwtPayload = { sub: usuario.id, email: usuario.email, rol: usuario.rol };
  return jwt.sign(payload, ENV.JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verificarToken(token: string): JwtPayload {
  return jwt.verify(token, ENV.JWT_SECRET) as JwtPayload;
}

/**
 * Verifica una contraseña contra el hash guardado.
 * - Si el hash tiene formato bcrypt ($2a$/$2b$/$2y$), usa bcryptjs en Node.
 * - Si no, hace fallback a la RPC verify_login (pgcrypto.crypt en Postgres),
 *   que es lo que se usaba antes del JWT. Permite que usuarios existentes
 *   sigan funcionando aunque su hash venga de otro algoritmo.
 */
async function verificarPassword(email: string, password: string, hash: string): Promise<boolean> {
  const esBcrypt = /^\$2[aby]\$/.test(hash);
  if (esBcrypt) {
    return bcrypt.compare(password, hash);
  }

  const { data, error } = await supabaseAdmin.rpc('verify_login', {
    p_email: email,
    p_password: password,
  });
  return !error && Array.isArray(data) && data.length > 0;
}

export interface AuthResult {
  token: string;
  usuario: UsuarioPublico;
}

export async function login(email: string, password: string): Promise<AuthResult | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();

  if (error || !data) return null;

  const row = data as UsuarioRow;
  if (!row.activo) return null;

  const ok = await verificarPassword(row.email, password, row.password_hash);
  if (!ok) return null;

  // Silent migration: si el hash no era bcrypt, lo re-hasheamos a bcrypt
  // tras un login exitoso para retirar el fallback en el futuro.
  if (!/^\$2[aby]\$/.test(row.password_hash)) {
    const nuevoHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await supabaseAdmin.from('users').update({ password_hash: nuevoHash }).eq('id', row.id);
  }

  return { token: firmarToken(row), usuario: toPublico(row) };
}

export interface RegistroInput {
  email: string;
  password: string;
  nombre: string;
}

export async function registro(input: RegistroInput): Promise<AuthResult | { error: string }> {
  const email = input.email.toLowerCase().trim();
  if (!email || !input.password || !input.nombre.trim()) {
    return { error: 'Email, contraseña y nombre son obligatorios.' };
  }
  if (input.password.length < 8) {
    return { error: 'La contraseña debe tener al menos 8 caracteres.' };
  }

  const { data: existente } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existente) return { error: 'Ya existe una cuenta con ese email.' };

  const password_hash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const { data, error } = await supabaseAdmin
    .from('users')
    .insert({
      email,
      nombre: input.nombre.trim(),
      password_hash,
      rol: 'trabajador',
      activo: true,
    })
    .select()
    .single();

  if (error || !data) {
    return { error: error?.message ?? 'No se pudo crear la cuenta.' };
  }

  const row = data as UsuarioRow;
  return { token: firmarToken(row), usuario: toPublico(row) };
}

export async function obtenerUsuarioPorId(id: string): Promise<UsuarioPublico | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as UsuarioRow;
  if (!row.activo) return null;
  return toPublico(row);
}
