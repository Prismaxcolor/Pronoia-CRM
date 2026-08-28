import { supabaseAdmin } from '../config/supabase.js';
import type { CrearLoteInput, ActualizarLoteInput } from '../schemas/lotes.js';

interface LoteRow {
  id: string;
  nombre: string;
  activo: boolean;
  almacen_id: string;
  almacenes?: { nombre: string } | null;
  created_at: string;
}

export interface LotePublico {
  id: string;
  nombre: string;
  activo: boolean;
  almacenId: string;
  almacenNombre: string | null;
  createdAt: string;
  stockKg: number;
}

function toPublico(row: LoteRow, stockKg = 0): LotePublico {
  return {
    id: row.id,
    nombre: row.nombre,
    activo: row.activo,
    almacenId: row.almacen_id,
    almacenNombre: row.almacenes?.nombre ?? null,
    createdAt: row.created_at,
    stockKg,
  };
}

/** Postgres lanza 23505 al violar el índice único de nombre. */
function esNombreDuplicado(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

/** stock_lote_total() por lote (Bloque 40) — la cantidad de lotes es chica
 *  (decenas, no miles), así que N llamadas RPC en paralelo es más simple que
 *  mantener un balance corriente. */
async function stockPorLote(ids: string[]): Promise<Map<string, number>> {
  const entradas = await Promise.all(
    ids.map(async id => {
      const { data } = await supabaseAdmin.rpc('stock_lote_total', { p_lote_id: id });
      return [id, Number(data ?? 0)] as const;
    })
  );
  return new Map(entradas);
}

export async function listarLotes(): Promise<LotePublico[]> {
  const { data, error } = await supabaseAdmin
    .from('lotes')
    .select('*, almacenes(nombre)')
    .order('nombre', { ascending: true });

  if (error || !data) return [];
  const rows = data as LoteRow[];
  const stocks = await stockPorLote(rows.map(r => r.id));
  return rows.map(r => toPublico(r, stocks.get(r.id) ?? 0));
}

export async function crearLote(
  input: CrearLoteInput
): Promise<{ lote: LotePublico } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('lotes')
    .insert({ nombre: input.nombre, almacen_id: input.almacenId })
    .select('*, almacenes(nombre)')
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
  if (cambios.almacenId !== undefined) update.almacen_id = cambios.almacenId;

  const { data, error } = await supabaseAdmin
    .from('lotes')
    .update(update)
    .eq('id', id)
    .select('*, almacenes(nombre)')
    .maybeSingle();

  if (error) {
    if (esNombreDuplicado(error)) return { error: 'Ya existe un lote con ese nombre.' };
    return { error: error.message };
  }
  if (!data) return { error: 'Lote no encontrado.' };
  // A diferencia de crearLote() (stock siempre 0 recién creado), acá el lote
  // puede ya tener stock real — nombre/activo no lo tocan, hay que leerlo.
  const { data: stockData } = await supabaseAdmin.rpc('stock_lote_total', { p_lote_id: id });
  return { lote: toPublico(data as LoteRow, Number(stockData ?? 0)) };
}
