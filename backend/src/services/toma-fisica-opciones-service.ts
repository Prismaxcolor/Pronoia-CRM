import { supabaseAdmin } from '../config/supabase.js';
import { leerPaginado } from '../utils/paginacion.js';
import { lotesElegiblesParaToma, type LoteParaToma } from '../utils/lotes-categoria-toma.js';

/** Lotes activos con las categorías de los productos anclados (producto_lotes). */
async function cargarLotesParaToma(): Promise<LoteParaToma[]> {
  const [{ data: lotes, error }, anclas] = await Promise.all([
    supabaseAdmin.from('lotes').select('id, nombre').eq('activo', true),
    leerPaginado<{ lote_id: string; productos: { tipo_material_id: string | null } | null }>((desde, hasta) =>
      supabaseAdmin
        .from('producto_lotes')
        .select('producto_id, lote_id, productos!inner(tipo_material_id)')
        .order('producto_id', { ascending: true })
        .order('lote_id', { ascending: true })
        .range(desde, hasta)
    ),
  ]);
  if (error) throw error;
  const categoriasPorLote = new Map<string, string[]>();
  for (const a of anclas) {
    const cat = a.productos?.tipo_material_id;
    if (cat) categoriasPorLote.set(a.lote_id, [...(categoriasPorLote.get(a.lote_id) ?? []), cat]);
  }
  return (lotes ?? []).map(l => ({
    id: l.id as string,
    nombre: l.nombre as string,
    categoriaIdsAncladas: categoriasPorLote.get(l.id as string) ?? [],
  }));
}

/** Ids de los lotes activos que se pueden contar para las categorías dadas
 *  (PCB sin el Lote 4; PGM solo el Lote 4). Ver utils/lotes-categoria-toma.ts. */
export async function lotesElegiblesDeCategorias(categoriaIds: readonly string[]): Promise<string[]> {
  if (categoriaIds.length === 0) return [];
  const [{ data: todas, error }, lotes] = await Promise.all([
    supabaseAdmin.from('tipos_material').select('id, nombre'),
    cargarLotesParaToma(),
  ]);
  if (error) throw error;
  const categorias = (todas ?? []).map(c => ({ id: c.id as string, nombre: c.nombre as string }));
  const elegidas = categorias.filter(c => categoriaIds.includes(c.id));
  return lotesElegiblesParaToma(lotes, elegidas, categorias);
}
