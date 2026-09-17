import { supabaseAdmin } from '../config/supabase.js';
import type { CrearLoteInput, ActualizarLoteInput } from '../schemas/lotes.js';
import type { ComposicionPCBItem } from '../../../shared/types/lote.js';

interface LoteRow {
  id: string;
  nombre: string;
  activo: boolean;
  fotos: string[];
  created_at: string;
}

export interface StockLoteAlmacen {
  almacenId: string;
  almacenNombre: string;
  stockKg: number;
  /** Composición de ESTE lote EN ESTE almacén — no es la misma que en otro
   *  almacén: cada uno acumula sus propias compras/transformaciones/
   *  traslados recibidos por separado (ver composicion_lote_almacen() en
   *  docs/migration_lote_composicion_por_almacen.sql). */
  composicion: ComposicionPCBItem[];
}

export interface LotePublico {
  id: string;
  nombre: string;
  activo: boolean;
  /** Un lote ya no vive en un solo almacén: puede tener porciones repartidas
   *  entre varios (ver docs/migration_lote_stock_por_almacen.sql). Este
   *  desglose es 100% derivado de compras/traslados/transformaciones/ajustes,
   *  nunca un campo editable a mano. */
  stockPorAlmacen: StockLoteAlmacen[];
  fotos: string[];
  composicion: ComposicionPCBItem[];
  createdAt: string;
  stockKg: number;
}

function toPublico(
  row: LoteRow,
  stockKg = 0,
  composicion: ComposicionPCBItem[] = [],
  stockPorAlmacen: StockLoteAlmacen[] = []
): LotePublico {
  return {
    id: row.id,
    nombre: row.nombre,
    activo: row.activo,
    stockPorAlmacen,
    fotos: row.fotos ?? [],
    composicion,
    createdAt: row.created_at,
    stockKg,
  };
}

interface ComposicionLoteRow {
  producto_nombre: string;
  porcentaje: number;
}

/** Composición de un lote — SIEMPRE calculada a partir de lo realmente
 *  pesado por producto dentro del lote (regla de tres), nunca declarada a
 *  mano: si entraron 250kg de A y 250kg de B, el sistema ya sabe que es
 *  50%/50%, no hace falta que nadie lo configure. */
async function composicionPorLote(ids: string[]): Promise<Map<string, ComposicionPCBItem[]>> {
  const entradas = await Promise.all(
    ids.map(async id => {
      const { data } = await supabaseAdmin.rpc('composicion_lote', { p_lote_id: id });
      const items: ComposicionPCBItem[] = ((data as ComposicionLoteRow[] | null) ?? []).map(r => ({
        item: r.producto_nombre,
        porcentaje: Number(r.porcentaje),
      }));
      return [id, items] as const;
    })
  );
  return new Map(entradas);
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

interface StockLoteAlmacenRow {
  almacen_id: string;
  stock: number;
}

interface ComposicionLoteAlmacenRow {
  producto_nombre: string;
  porcentaje: number;
}

/** composicion_lote_almacen() para un (lote, almacén) puntual — la
 *  composición REAL de ese lote en ESE almacén, no la mezcla global. */
async function composicionDeLoteEnAlmacen(loteId: string, almacenId: string): Promise<ComposicionPCBItem[]> {
  const { data } = await supabaseAdmin.rpc('composicion_lote_almacen', {
    p_lote_id: loteId,
    p_almacen_id: almacenId,
  });
  return ((data as ComposicionLoteAlmacenRow[] | null) ?? []).map(r => ({
    item: r.producto_nombre,
    porcentaje: Number(r.porcentaje),
  }));
}

/** stock_lote_por_almacen() por lote — desglose de en qué almacén(es) vive
 *  cada lote hoy, con la composición propia de cada uno (ver
 *  docs/migration_lote_composicion_por_almacen.sql). La cantidad de pares
 *  (lote, almacén) con stock real es chica (decenas), así que N llamadas
 *  RPC en paralelo es más simple que traer todo en una sola consulta. */
async function stockPorAlmacenPorLote(ids: string[]): Promise<Map<string, StockLoteAlmacen[]>> {
  const { data: almacenes } = await supabaseAdmin.from('almacenes').select('id, nombre');
  const nombrePorAlmacen = new Map((almacenes ?? []).map(a => [a.id as string, a.nombre as string]));

  const entradas = await Promise.all(
    ids.map(async id => {
      const { data } = await supabaseAdmin.rpc('stock_lote_por_almacen', { p_lote_id: id });
      const filas = ((data as StockLoteAlmacenRow[] | null) ?? []).filter(r => Math.abs(Number(r.stock)) > 0.01);
      const items: StockLoteAlmacen[] = await Promise.all(
        filas.map(async r => ({
          almacenId: r.almacen_id,
          almacenNombre: nombrePorAlmacen.get(r.almacen_id) ?? '—',
          stockKg: Number(r.stock),
          composicion: await composicionDeLoteEnAlmacen(id, r.almacen_id),
        }))
      );
      return [id, items] as const;
    })
  );
  return new Map(entradas);
}

export async function listarLotes(): Promise<LotePublico[]> {
  const { data, error } = await supabaseAdmin
    .from('lotes')
    .select('*')
    .order('nombre', { ascending: true });

  if (error || !data) return [];
  const rows = data as LoteRow[];
  const ids = rows.map(r => r.id);
  const [stocks, composiciones, stocksPorAlmacen] = await Promise.all([
    stockPorLote(ids),
    composicionPorLote(ids),
    stockPorAlmacenPorLote(ids),
  ]);
  return rows.map(r =>
    toPublico(r, stocks.get(r.id) ?? 0, composiciones.get(r.id) ?? [], stocksPorAlmacen.get(r.id) ?? [])
  );
}

export async function crearLote(
  input: CrearLoteInput
): Promise<{ lote: LotePublico } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('lotes')
    .insert({ nombre: input.nombre, fotos: input.fotos ?? [] })
    .select('*')
    .single();

  if (error || !data) {
    if (esNombreDuplicado(error)) return { error: 'Ya existe un lote con ese nombre.' };
    return { error: error?.message ?? 'No se pudo crear el lote.' };
  }
  // Recién creado: sin stock ni composición todavía — el almacén se deriva
  // recién cuando entre el primer material (compra o transformación).
  return { lote: toPublico(data as LoteRow) };
}

export async function actualizarLote(
  id: string,
  cambios: ActualizarLoteInput
): Promise<{ lote: LotePublico } | { error: string }> {
  const update: Record<string, unknown> = {};
  if (cambios.nombre !== undefined) update.nombre = cambios.nombre;
  if (cambios.activo !== undefined) update.activo = cambios.activo;
  if (cambios.fotos !== undefined) update.fotos = cambios.fotos;

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
  // A diferencia de crearLote() (stock siempre 0 recién creado), acá el lote
  // puede ya tener stock y composición reales — nombre/activo no lo tocan, hay que leerlos.
  const [stocks, composiciones, stocksPorAlmacen] = await Promise.all([
    stockPorLote([id]),
    composicionPorLote([id]),
    stockPorAlmacenPorLote([id]),
  ]);
  return {
    lote: toPublico(
      data as LoteRow,
      stocks.get(id) ?? 0,
      composiciones.get(id) ?? [],
      stocksPorAlmacen.get(id) ?? []
    ),
  };
}
