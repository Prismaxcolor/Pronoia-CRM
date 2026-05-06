import { supabaseAdmin } from '../config/supabase.js';
import type { CrearClienteInput, ActualizarClienteInput } from '../schemas/clientes.js';

interface ClienteRow {
  id: string;
  nombre: string;
  identificacion: string | null;
  email: string | null;
  telefono: string | null;
  direccion: string | null;
  notas: string | null;
  activo: boolean;
  creado_por: string | null;
  creado_en: string;
}

export interface ClientePublico {
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

function toPublico(row: ClienteRow): ClientePublico {
  return {
    id: row.id,
    nombre: row.nombre,
    identificacion: row.identificacion,
    email: row.email,
    telefono: row.telefono,
    direccion: row.direccion,
    notas: row.notas,
    activo: row.activo,
    creadoPor: row.creado_por ?? '',
    creadoEn: row.creado_en,
  };
}

export async function listarClientes(): Promise<ClientePublico[]> {
  const { data, error } = await supabaseAdmin
    .from('clientes')
    .select('*')
    .order('creado_en', { ascending: false });

  if (error || !data) return [];
  return (data as ClienteRow[]).map(toPublico);
}

export async function crearCliente(
  input: CrearClienteInput,
  creadoPor: string
): Promise<{ cliente: ClientePublico } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('clientes')
    .insert({
      nombre: input.nombre,
      identificacion: input.identificacion,
      email: input.email,
      telefono: input.telefono,
      direccion: input.direccion,
      notas: input.notas,
      creado_por: creadoPor,
    })
    .select('*')
    .single();

  if (error || !data) return { error: error?.message ?? 'No se pudo crear el cliente.' };
  return { cliente: toPublico(data as ClienteRow) };
}

export async function actualizarCliente(
  id: string,
  cambios: ActualizarClienteInput
): Promise<{ cliente: ClientePublico } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('clientes')
    .update(cambios)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: 'Cliente no encontrado.' };
  return { cliente: toPublico(data as ClienteRow) };
}

export async function desactivarCliente(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('clientes')
    .update({ activo: false })
    .eq('id', id);
  return !error;
}

export async function reactivarCliente(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('clientes')
    .update({ activo: true })
    .eq('id', id);
  return !error;
}

export async function borrarCliente(id: string): Promise<{ ok: boolean; razon?: string }> {
  const { error } = await supabaseAdmin.from('clientes').delete().eq('id', id);
  if (error) return { ok: false, razon: error.message };
  return { ok: true };
}
