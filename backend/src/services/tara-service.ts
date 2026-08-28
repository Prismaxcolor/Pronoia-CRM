import { supabaseAdmin } from '../config/supabase.js';
import type { CrearTaraInput, ActualizarTaraInput } from '../schemas/tara.js';

interface TaraRow {
  id: string;
  nombre: string;
  peso: number;
  fotos: string[] | null;
  activo: boolean;
  created_at: string;
}

export interface TaraPublica {
  id: string;
  nombre: string;
  peso: number;
  fotos: string[];
  activo: boolean;
  createdAt: string;
}

function toPublico(row: TaraRow): TaraPublica {
  return {
    id: row.id,
    nombre: row.nombre,
    peso: Number(row.peso),
    fotos: row.fotos ?? [],
    activo: row.activo,
    createdAt: row.created_at,
  };
}

export async function listarTaras(): Promise<TaraPublica[]> {
  const { data, error } = await supabaseAdmin
    .from('taras')
    .select('*')
    .order('nombre', { ascending: true });

  if (error || !data) return [];
  return (data as TaraRow[]).map(toPublico);
}

export async function crearTara(
  input: CrearTaraInput
): Promise<{ tara: TaraPublica } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('taras')
    .insert({ nombre: input.nombre, peso: input.peso, fotos: input.fotos ?? [] })
    .select('*')
    .single();

  if (error || !data) return { error: error?.message ?? 'No se pudo crear la tara.' };
  return { tara: toPublico(data as TaraRow) };
}

export async function actualizarTara(
  id: string,
  cambios: ActualizarTaraInput
): Promise<{ tara: TaraPublica } | { error: string }> {
  const update: Record<string, unknown> = {};
  if (cambios.nombre !== undefined) update.nombre = cambios.nombre;
  if (cambios.peso !== undefined) update.peso = cambios.peso;
  if (cambios.fotos !== undefined) update.fotos = cambios.fotos;
  if (cambios.activo !== undefined) update.activo = cambios.activo;

  const { data, error } = await supabaseAdmin
    .from('taras')
    .update(update)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: 'Tara no encontrada.' };
  return { tara: toPublico(data as TaraRow) };
}

export async function desactivarTara(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from('taras').update({ activo: false }).eq('id', id);
  return !error;
}

export async function reactivarTara(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from('taras').update({ activo: true }).eq('id', id);
  return !error;
}
