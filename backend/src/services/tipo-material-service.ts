import { supabaseAdmin } from '../config/supabase.js';
import { leerPaginado, trocear } from '../utils/paginacion.js';
import type {
  CrearTipoMaterialInput,
  ActualizarTipoMaterialInput,
} from '../schemas/tipos-material.js';

interface TipoMaterialRow {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  sin_lote: boolean;
  created_at: string;
}

export interface TipoMaterialPublico {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  sinLote: boolean;
  /** true si algún producto de la categoría tiene lotes posibles (producto_lotes):
   *  esa categoría se inventaría por lote, no por categoría. */
  tieneProductosAnclados: boolean;
  createdAt: string;
}

function toPublico(row: TipoMaterialRow, tieneProductosAnclados = false): TipoMaterialPublico {
  return {
    id: row.id,
    nombre: row.nombre,
    descripcion: row.descripcion,
    activo: row.activo,
    sinLote: row.sin_lote,
    tieneProductosAnclados,
    createdAt: row.created_at,
  };
}

/** Postgres lanza 23505 al violar el índice único de nombre. */
function esNombreDuplicado(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

/** Ids de categorías (entre las pedidas, o todas) con al menos un producto anclado a un lote.
 *  Lanza si la consulta falla: un error no debe leerse como "sin anclados". */
export async function categoriaIdsConProductosAnclados(ids?: string[]): Promise<Set<string>> {
  const anclados = new Set<string>();
  if (ids && ids.length === 0) return anclados;
  const lotesDeIds = ids ? trocear([...new Set(ids)]) : [undefined];
  for (const lote of lotesDeIds) {
    const filas = await leerPaginado<{ productos: { tipo_material_id: string | null } | null }>((desde, hasta) => {
      let q = supabaseAdmin
        .from('producto_lotes')
        .select('producto_id, lote_id, productos!inner(tipo_material_id)')
        .order('producto_id', { ascending: true })
        .order('lote_id', { ascending: true })
        .range(desde, hasta);
      if (lote) q = q.in('productos.tipo_material_id', lote);
      return q;
    });
    for (const fila of filas) {
      const cat = fila.productos?.tipo_material_id;
      if (cat) anclados.add(cat);
    }
  }
  return anclados;
}

export async function listarTiposMaterial(): Promise<TipoMaterialPublico[]> {
  const { data, error } = await supabaseAdmin
    .from('tipos_material')
    .select('*')
    .order('nombre', { ascending: true });

  if (error || !data) return [];
  const anclados = await categoriaIdsConProductosAnclados();
  return (data as TipoMaterialRow[]).map(r => toPublico(r, anclados.has(r.id)));
}

export async function crearTipoMaterial(
  input: CrearTipoMaterialInput
): Promise<{ tipo: TipoMaterialPublico } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('tipos_material')
    .insert({ nombre: input.nombre, descripcion: input.descripcion, sin_lote: input.sinLote })
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
  if (cambios.sinLote !== undefined) update.sin_lote = cambios.sinLote;

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
  const anclados = await categoriaIdsConProductosAnclados([id]);
  return { tipo: toPublico(data as TipoMaterialRow, anclados.has(id)) };
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

export interface BorrarTipoMaterialResult {
  ok: boolean;
  razon?: string;
  referencias?: { productos: number };
}

/**
 * Borrado físico. Solo permitido si ningún producto usa la categoría. Si hay
 * productos asignados, se mantiene desactivada (no rompe el historial).
 */
export async function borrarTipoMaterial(id: string): Promise<BorrarTipoMaterialResult> {
  const { count } = await supabaseAdmin
    .from('productos')
    .select('id', { count: 'exact', head: true })
    .eq('tipo_material_id', id);

  const productos = count ?? 0;
  if (productos > 0) {
    return {
      ok: false,
      razon: `La categoría la usan ${productos} producto${productos > 1 ? 's' : ''}. Reasígnalos o desactívala en vez de borrarla.`,
      referencias: { productos },
    };
  }

  const { error } = await supabaseAdmin.from('tipos_material').delete().eq('id', id);
  if (error) return { ok: false, razon: error.message };
  return { ok: true };
}
