import { supabaseAdmin } from '../config/supabase.js';
import type { CrearLoteInput, ActualizarLoteInput } from '../schemas/lotes.js';

interface LoteRow {
  id: string;
  nombre: string;
  activo: boolean;
  created_at: string;
}

export interface LotePublico {
  id: string;
  nombre: string;
  activo: boolean;
  createdAt: string;
}

function toPublico(row: LoteRow): LotePublico {
  return { id: row.id, nombre: row.nombre, activo: row.activo, createdAt: row.created_at };
}

/** Postgres lanza 23505 al violar el índice único de nombre. */
function esNombreDuplicado(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

export async function listarLotes(): Promise<LotePublico[]> {
  const { data, error } = await supabaseAdmin
    .from('lotes')
    .select('*')
    .order('nombre', { ascending: true });

  if (error || !data) return [];
  return (data as LoteRow[]).map(toPublico);
}

export async function crearLote(
  input: CrearLoteInput
): Promise<{ lote: LotePublico } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('lotes')
    .insert({ nombre: input.nombre })
    .select('*')
    .single();

  if (error || !data) {
    if (esNombreDuplicado(error)) return { error: 'Ya existe un lote con ese nombre.' };
    return { error: error?.message ?? 'No se pudo crear el lote.' };
  }
  return { lote: toPublico(data as LoteRow) };
}

export async function actualizarLote(
  id: string,
  cambios: ActualizarLoteInput
): Promise<{ lote: LotePublico } | { error: string }> {
  const update: Record<string, unknown> = {};
  if (cambios.nombre !== undefined) update.nombre = cambios.nombre;
  if (cambios.activo !== undefined) update.activo = cambios.activo;

  const { data, error } = await supabaseAdmin
    .from('lotes')
    .update(update)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    if (esNombreDuplicado(error)) return { error: 'Ya existe un lote con ese nombre.' };
    return { error: error.message };
  }
  if (!data) return { error: 'Lote no encontrado.' };
  return { lote: toPublico(data as LoteRow) };
}
