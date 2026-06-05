import { supabaseAdmin } from '../config/supabase.js';
import type { CrearProveedorInput, ActualizarProveedorInput } from '../schemas/proveedores.js';

interface ProveedorRow {
  id: string;
  nombre: string;
  rfc: string | null;
  telefono: string | null;
  email: string | null;
  activo: boolean;
  created_at: string;
}

export interface ProveedorPublico {
  id: string;
  nombre: string;
  rfc: string | null;
  telefono: string | null;
  email: string | null;
  activo: boolean;
  createdAt: string;
}

function toPublico(row: ProveedorRow): ProveedorPublico {
  return {
    id: row.id,
    nombre: row.nombre,
    rfc: row.rfc,
    telefono: row.telefono,
    email: row.email,
    activo: row.activo,
    createdAt: row.created_at,
  };
}

export async function listarProveedores(): Promise<ProveedorPublico[]> {
  const { data, error } = await supabaseAdmin
    .from('proveedores')
    .select('*')
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return (data as ProveedorRow[]).map(toPublico);
}

export async function crearProveedor(
  input: CrearProveedorInput
): Promise<{ proveedor: ProveedorPublico } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('proveedores')
    .insert({
      nombre: input.nombre,
      rfc: input.rfc,
      telefono: input.telefono,
      email: input.email,
    })
    .select('*')
    .single();

  if (error || !data) return { error: error?.message ?? 'No se pudo crear el proveedor.' };
  return { proveedor: toPublico(data as ProveedorRow) };
}

export async function actualizarProveedor(
  id: string,
  cambios: ActualizarProveedorInput
): Promise<{ proveedor: ProveedorPublico } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('proveedores')
    .update(cambios)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: 'Proveedor no encontrado.' };
  return { proveedor: toPublico(data as ProveedorRow) };
}

export async function desactivarProveedor(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('proveedores')
    .update({ activo: false })
    .eq('id', id);
  return !error;
}

export async function reactivarProveedor(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('proveedores')
    .update({ activo: true })
    .eq('id', id);
  return !error;
}

export async function borrarProveedor(id: string): Promise<{ ok: boolean; razon?: string }> {
  const { error } = await supabaseAdmin.from('proveedores').delete().eq('id', id);
  if (error) return { ok: false, razon: error.message };
  return { ok: true };
}
