import { supabaseAdmin } from '../config/supabase.js';
import type { CrearAlmacenInput, ActualizarAlmacenInput } from '../schemas/almacen.js';

interface AlmacenRow {
  id: string;
  nombre: string;
  detalle: string | null;
  activo: boolean;
  created_at: string;
}

export interface AlmacenPublico {
  id: string;
  nombre: string;
  detalle: string | null;
  activo: boolean;
  createdAt: string;
}

function toPublico(row: AlmacenRow): AlmacenPublico {
  return {
    id: row.id,
    nombre: row.nombre,
    detalle: row.detalle,
    activo: row.activo,
    createdAt: row.created_at,
  };
}

export async function listarAlmacenes(): Promise<AlmacenPublico[]> {
  const { data, error } = await supabaseAdmin
    .from('almacenes')
    .select('*')
    .order('nombre', { ascending: true });

  if (error || !data) return [];
  return (data as AlmacenRow[]).map(toPublico);
}

export async function crearAlmacen(
  input: CrearAlmacenInput
): Promise<{ almacen: AlmacenPublico } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('almacenes')
    .insert({ nombre: input.nombre, detalle: input.detalle ?? null })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') return { error: 'Ya existe un almacén con ese nombre.' };
    return { error: error.message };
  }
  return { almacen: toPublico(data as AlmacenRow) };
}

export async function actualizarAlmacen(
  id: string,
  cambios: ActualizarAlmacenInput
): Promise<{ almacen: AlmacenPublico } | { error: string }> {
  const update: Record<string, unknown> = {};
  if (cambios.nombre !== undefined) update.nombre = cambios.nombre;
  if (cambios.detalle !== undefined) update.detalle = cambios.detalle;
  if (cambios.activo !== undefined) update.activo = cambios.activo;

  const { data, error } = await supabaseAdmin
    .from('almacenes')
    .update(update)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') return { error: 'Ya existe un almacén con ese nombre.' };
    return { error: error.message };
  }
  if (!data) return { error: 'Almacén no encontrado.' };
  return { almacen: toPublico(data as AlmacenRow) };
}

export async function desactivarAlmacen(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from('almacenes').update({ activo: false }).eq('id', id);
  return !error;
}

export async function reactivarAlmacen(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from('almacenes').update({ activo: true }).eq('id', id);
  return !error;
}

/** Stock actual del almacén por material (kg), derivado de traslados
 *  completados (recepciones - envíos). Solo incluye materiales con
 *  movimiento — uno que nunca se tocó simplemente no aparece (= 0). */
export async function stockAlmacen(almacenId: string): Promise<Map<string, number>> {
  const { data, error } = await supabaseAdmin.rpc('stock_almacen', { p_almacen_id: almacenId });
  const mapa = new Map<string, number>();
  if (error || !data) return mapa;
  for (const fila of data as Array<{ producto_id: string; stock: number }>) {
    mapa.set(fila.producto_id, Number(fila.stock));
  }
  return mapa;
}
