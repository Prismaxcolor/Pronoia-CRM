import { supabaseAdmin } from '../config/supabase.js';
import type {
  CrearTipoMaterialInput,
  ActualizarTipoMaterialInput,
} from '../schemas/tipos-material.js';

interface TipoMaterialRow {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  created_at: string;
}

export interface TipoMaterialPublico {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  createdAt: string;
}

function toPublico(row: TipoMaterialRow): TipoMaterialPublico {
  return {
    id: row.id,
    nombre: row.nombre,
    descripcion: row.descripcion,
    activo: row.activo,
    createdAt: row.created_at,
  };
}

/** Postgres lanza 23505 al violar el índice único de nombre. */
function esNombreDuplicado(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

export async function listarTiposMaterial(): Promise<TipoMaterialPublico[]> {
  const { data, error } = await supabaseAdmin
    .from('tipos_material')
    .select('*')
    .order('nombre', { ascending: true });

  if (error || !data) return [];
  return (data as TipoMaterialRow[]).map(toPublico);
}

export async function crearTipoMaterial(
  input: CrearTipoMaterialInput
): Promise<{ tipo: TipoMaterialPublico } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('tipos_material')
    .insert({ nombre: input.nombre, descripcion: input.descripcion })
    .select('*')
    .single();

  if (error || !data) {
    if (esNombreDuplicado(error)) return { error: 'Ya existe una categoría con ese nombre.' };
    return { error: error?.message ?? 'No se pudo crear la categoría.' };
  }
  return { tipo: toPublico(data as TipoMaterialRow) };
}

export async function actualizarTipoMaterial(
  id: string,
  cambios: ActualizarTipoMaterialInput
): Promise<{ tipo: TipoMaterialPublico } | { error: string }> {
  const update: Record<string, unknown> = {};
  if (cambios.nombre !== undefined) update.nombre = cambios.nombre;
  if (cambios.descripcion !== undefined) update.descripcion = cambios.descripcion;
  if (cambios.activo !== undefined) update.activo = cambios.activo;

  const { data, error } = await supabaseAdmin
    .from('tipos_material')
    .update(update)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    if (esNombreDuplicado(error)) return { error: 'Ya existe una categoría con ese nombre.' };
    return { error: error.message };
  }
  if (!data) return { error: 'Categoría no encontrada.' };
  return { tipo: toPublico(data as TipoMaterialRow) };
}

export async function desactivarTipoMaterial(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('tipos_material')
    .update({ activo: false })
    .eq('id', id);
  return !error;
}

export async function reactivarTipoMaterial(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('tipos_material')
    .update({ activo: true })
    .eq('id', id);
  return !error;
}
