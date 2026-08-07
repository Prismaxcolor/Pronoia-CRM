import { supabaseAdmin } from '../config/supabase.js';
import type { CrearAlmacenInput, ActualizarAlmacenInput } from '../schemas/almacen.js';

interface AlmacenRow {
  id: string;
  nombre: string;
  detalle: string | null;
  activo: boolean;
  es_predeterminado: boolean;
  created_at: string;
}

export interface AlmacenPublico {
  id: string;
  nombre: string;
  detalle: string | null;
  activo: boolean;
  esPredeterminado: boolean;
  createdAt: string;
}

function toPublico(row: AlmacenRow): AlmacenPublico {
  return {
    id: row.id,
    nombre: row.nombre,
    detalle: row.detalle,
    activo: row.activo,
    esPredeterminado: row.es_predeterminado,
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

  let almacen = toPublico(data as AlmacenRow);

  // Si no hay ningún predeterminado activo todavía, el primer almacén que se
  // crea lo asume automáticamente — así compras/ventas nunca quedan sin
  // almacén por falta de configurar la estrella a mano.
  const { count } = await supabaseAdmin
    .from('almacenes')
    .select('id', { count: 'exact', head: true })
    .eq('es_predeterminado', true)
    .eq('activo', true);

  if (!count) {
    const { error: rpcError } = await supabaseAdmin.rpc('marcar_almacen_predeterminado', {
      p_almacen_id: almacen.id,
    });
    if (!rpcError) almacen = { ...almacen, esPredeterminado: true };
  }

  return { almacen };
}

/** Marca este almacén como el único predeterminado (recibe/pierde stock por
 *  compra/venta). Desmarca al anterior de forma atómica (RPC). */
export async function marcarPredeterminado(
  id: string
): Promise<{ almacen: AlmacenPublico } | { error: string }> {
  const { error } = await supabaseAdmin.rpc('marcar_almacen_predeterminado', { p_almacen_id: id });
  if (error) return { error: error.message };

  const { data, error: readError } = await supabaseAdmin
    .from('almacenes')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (readError || !data) return { error: 'No se pudo leer el almacén actualizado.' };
  return { almacen: toPublico(data as AlmacenRow) };
}

export async function actualizarAlmacen(
  id: string,
  cambios: ActualizarAlmacenInput
): Promise<{ almacen: AlmacenPublico } | { error: string }> {
  if (cambios.activo === false) {
    const { data: existente } = await supabaseAdmin
      .from('almacenes')
      .select('es_predeterminado')
      .eq('id', id)
      .maybeSingle();
    if ((existente as { es_predeterminado?: boolean } | null)?.es_predeterminado) {
      return { error: 'Marca otro almacén como predeterminado antes de desactivar este.' };
    }
  }

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

export async function desactivarAlmacen(id: string): Promise<{ ok: true } | { error: string }> {
  const { data: existente } = await supabaseAdmin
    .from('almacenes')
    .select('es_predeterminado')
    .eq('id', id)
    .maybeSingle();

  if ((existente as { es_predeterminado?: boolean } | null)?.es_predeterminado) {
    return { error: 'Marca otro almacén como predeterminado antes de desactivar este.' };
  }

  const { error } = await supabaseAdmin.from('almacenes').update({ activo: false }).eq('id', id);
  if (error) return { error: error.message };
  return { ok: true };
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
