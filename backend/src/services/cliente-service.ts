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
  fotos: string[] | null;
  telegram_chat_id: string | null;
  telegram_linked_at: string | null;
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
  fotos: string[];
  telegramChatId: string | null;
  telegramLinkedAt: string | null;
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
    fotos: row.fotos ?? [],
    telegramChatId: row.telegram_chat_id,
    telegramLinkedAt: row.telegram_linked_at,
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
      fotos: input.fotos ?? [],
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
  const update: Record<string, unknown> = {};
  if (cambios.nombre !== undefined) update.nombre = cambios.nombre;
  if (cambios.identificacion !== undefined) update.identificacion = cambios.identificacion;
  if (cambios.email !== undefined) update.email = cambios.email;
  if (cambios.telefono !== undefined) update.telefono = cambios.telefono;
  if (cambios.direccion !== undefined) update.direccion = cambios.direccion;
  if (cambios.notas !== undefined) update.notas = cambios.notas;
  if (cambios.fotos !== undefined) update.fotos = cambios.fotos;
  if (cambios.activo !== undefined) update.activo = cambios.activo;

  const { data, error } = await supabaseAdmin
    .from('clientes')
    .update(update)
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
