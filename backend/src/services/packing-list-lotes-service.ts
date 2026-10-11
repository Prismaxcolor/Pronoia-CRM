import { supabaseAdmin } from '../config/supabase.js';
import type { OpcionLotePacking } from '../../../shared/types/index.js';
import { esCategoriaCatalizadores, esLoteCatalizadores } from '../utils/lotes-categoria-toma.js';
import { leerClasificacion } from '../utils/lote-clasificacion.js';
import { CLAVES_COLOR_LOTE, armarOpcionesLoteSinDisponible, armarOpcionesLotePacking, seOfreceEnPacking, type LoteConStock } from '../utils/packing-list-lotes.js';
import { logger } from '../utils/logger.js';
import { cargarLotesParaToma } from './toma-fisica-opciones-service.js';

export const MENSAJE_LOTES_PACKING_NO_LEIDOS = 'No se pudieron leer los lotes de exportación. Intenta de nuevo.';

/** Umbral bajo el cual un almacén se considera sin stock (mismo criterio que el panel de Lotes). */
const STOCK_MINIMO_KG = 0.01;

interface LoteFila {
  id: string;
  nombre: string;
  clase?: unknown;
  color_packing_list?: string | null;
}

interface StockAlmacenFila {
  almacen_id: string;
  stock: number | string;
}

const colorValido = (c: string | null | undefined): string | null =>
  c && (CLAVES_COLOR_LOTE as readonly string[]).includes(c) ? c : null;

/** IDs de los lotes de catalizadores (PGM / LOTE 4): el packing es de PCB y no los ofrece. */
async function idsLotesCatalizadores(): Promise<Set<string>> {
  const [{ data: tipos, error }, lotes] = await Promise.all([
    supabaseAdmin.from('tipos_material').select('id, nombre'),
    cargarLotesParaToma(),
  ]);
  if (error) throw error;
  const categorias = (tipos ?? []).map(t => ({ id: t.id as string, nombre: t.nombre as string }));
  const idsPgm = new Set(categorias.filter(esCategoriaCatalizadores).map(c => c.id));
  return new Set(lotes.filter(l => esLoteCatalizadores(l, idsPgm)).map(l => l.id));
}

/**
 * Kg del lote en cada almacén (stock_lote_por_almacen), sin los almacenes en cero. Si la lectura falla devuelve
 * `null` (dato desconocido): jamás [] -- que se mostraría como 0 kg y dispararía un falso aviso de exceso.
 */
async function stockPorAlmacen(loteId: string, nombres: ReadonlyMap<string, string>): Promise<LoteConStock['porAlmacen'] | null> {
  const { data, error } = await supabaseAdmin.rpc('stock_lote_por_almacen', { p_lote_id: loteId });
  if (error) {
    logger.warn({ evento: 'packing_lote_stock_no_leido', loteId, motivo: error.message });
    return null;
  }
  return ((data ?? []) as StockAlmacenFila[])
    .filter(r => Math.abs(Number(r.stock)) > STOCK_MINIMO_KG)
    .map(r => ({ almacenId: r.almacen_id, almacenNombre: nombres.get(r.almacen_id) ?? 'Almacén sin nombre', stockKg: Number(r.stock) }));
}

export interface OpcionesLotesPacking {
  /** productos:ver o facturacion:ver. Sin él no se leen kg ni almacenes (dato de control interno). */
  puedeVerDisponible?: boolean;
}

/**
 * Lotes de exportación activos con los kg disponibles por almacén, para el selector del packing list.
 * Solo lectura: no descuenta ni mueve inventario. Dato de CONTROL INTERNO.
 */
export async function listarOpcionesLotePacking(opciones: OpcionesLotesPacking = {}): Promise<OpcionLotePacking[]> {
  const conDisponible = opciones.puedeVerDisponible === true;
  const [lotesRes, almacenesRes, catalizadores] = await Promise.all([
    supabaseAdmin.from('lotes').select('*').eq('activo', true),
    conDisponible ? supabaseAdmin.from('almacenes').select('id, nombre') : Promise.resolve({ data: [] }),
    idsLotesCatalizadores(),
  ]);
  if (lotesRes.error) throw lotesRes.error;
  const nombres = new Map(((almacenesRes.data ?? []) as Array<{ id: string; nombre: string }>).map(a => [a.id, a.nombre] as const));
  const ofrecidos = ((lotesRes.data ?? []) as LoteFila[]).filter(l =>
    seOfreceEnPacking({
      nombre: l.nombre,
      activo: true,
      // Sin la migración de clasificación la columna no existe: clase queda indefinida.
      clase: 'clase' in l ? leerClasificacion(l).clase : undefined,
      esCatalizadores: catalizadores.has(l.id),
    })
  );
  if (!conDisponible) {
    return armarOpcionesLoteSinDisponible(ofrecidos.map(l => ({ id: l.id, nombre: l.nombre, color: colorValido(l.color_packing_list) })));
  }
  const conStock = await Promise.all(
    ofrecidos.map(async (l): Promise<LoteConStock> => {
      const porAlmacen = await stockPorAlmacen(l.id, nombres);
      return {
        id: l.id,
        nombre: l.nombre,
        color: colorValido(l.color_packing_list),
        stockKg: (porAlmacen ?? []).reduce((s, a) => s + a.stockKg, 0),
        stockNoLeido: porAlmacen === null,
        porAlmacen: porAlmacen ?? [],
      };
    })
  );
  return armarOpcionesLotePacking(conStock);
}
