/** Un ítem dentro de la composición estimada de un lote PCB. */
export interface ComposicionPCBItem {
  item: string;
  porcentaje: number;
}

/** Cuánto de un lote vive físicamente en un almacén concreto, ahora mismo,
 *  y con QUÉ composición — cada almacén acumula sus propias compras y
 *  transformaciones por separado, así que el mismo lote puede tener una
 *  composición distinta en cada almacén donde tiene stock. */
export interface StockLoteAlmacen {
  almacenId: string;
  almacenNombre: string;
  stockKg: number;
  /** Kilos embalados/listos de este lote en este almacén (recortados al stock). */
  embaladoKg?: number;
  /** Kilos todavía en saca = stock - embalado. */
  enSacaKg?: number;
  composicion: ComposicionPCBItem[];
}

/** Clasificación de un lote: de exportación (Lote 1-4), de trabajo interno (BGPP, BGYP,
 *  PCPP, PCYP, LOTE MPP) u otro. */
export type ClaseLote = 'exportacion' | 'trabajo' | 'otro';

/** Cuánto de un lote está embalado/listo (por kilos; un lote puede estar parte embalado y parte en saca). */
export interface EmbaladoLote {
  stockKg: number;
  /** Suma de embalajes vigentes tal como se marcaron (puede exceder el stock). */
  embaladoMarcadoKg: number;
  /** Lo que el stock actual respalda: min(marcado, stock). */
  embaladoKg: number;
  enSacaKg: number;
  /** Los embalajes vigentes superan el stock actual (se vendió, despachó o transformó parte). */
  embaladoMayorQueStock: boolean;
  excesoKg: number;
}

/**
 * Lote — destino de inventario gestionado (Lote 1, Lote 2, ...). Junto con MPP
 * (Material Por Procesar), define dónde se acumula el stock de cada material
 * pesado en un ticket.
 *
 * Un lote NO vive en un solo almacén: es un "producto compuesto" — su
 * composición (composicion) es siempre global, pero su peso puede estar
 * repartido entre varios almacenes a la vez (ver
 * docs/migration_lote_stock_por_almacen.sql). stockPorAlmacen es 100%
 * derivado de compras/traslados/transformaciones/ajustes, nunca editable.
 */
export interface Lote {
  id: string;
  nombre: string;
  activo: boolean;
  /** Desglose de en qué almacén(es) está este lote y cuántos kg en cada uno. */
  stockPorAlmacen: StockLoteAlmacen[];
  /** URLs públicas de las fotos del lote (bucket "lotes" en Storage). */
  fotos: string[];
  /** ISO timestamp (created_at en BD). */
  createdAt: string;
  /** Kg reales en este lote ahora mismo (Bloque 40: stock_lote_total). Suma
   *  compras/traslados directos a este lote y salidas de transformaciones que
   *  lo alimentaron, menos ventas directas y retiros de transformaciones que
   *  lo usaron como origen. */
  stockKg: number;
  /** Composición real del lote por producto — SIEMPRE derivada del stock
   *  realmente pesado dentro del lote (regla de tres), nunca declarada a
   *  mano. Solo lectura. Suma ~100% cuando el lote tiene stock. */
  composicion: ComposicionPCBItem[];
  /** Ausente si el backend aún no tiene la migración de clasificación aplicada (equivale a 'otro'). */
  clase?: ClaseLote;
  /** USD/kg aproximado de VENTA, cargado a mano (los lotes mezclan materiales y no se costean). null = sin precio. */
  precioEstimadoKg?: number | null;
  precioEstimadoActualizadoEn?: string | null;
  precioEstimadoActualizadoPorNombre?: string | null;
  /** Resumen de embalado por kilos (ausente si la migración no está aplicada). */
  embalado?: EmbaladoLote;
}

/** Destino de inventario de una línea de pesaje: MPP o un lote concreto. */
export type DestinoTipo = 'mpp' | 'lote';

/** Etiqueta legible de un destino: "Sin lote" (el material nunca se asignó
 *  a un lote — el caso normal de Ferroso/No Ferroso, categorías que no
 *  usan lotes) o el nombre del lote. */
export function destinoLabel(destinoTipo: DestinoTipo, nombreLote?: string | null): string {
  return destinoTipo === 'lote' ? (nombreLote ?? 'Lote') : 'Sin lote';
}

/** Ordena los lotes para el selector de destino: primero los anclados al
 *  producto (marcados), luego el resto; cada grupo por nombre. No muta la entrada. */
export function ordenarLotesPorAnclaje<T extends { id: string; nombre: string }>(
  lotes: readonly T[],
  loteIdsAnclados: readonly string[]
): Array<T & { anclado: boolean }> {
  const anclados = new Set(loteIdsAnclados);
  const conMarca = lotes.map(l => ({ ...l, anclado: anclados.has(l.id) }));
  return conMarca.sort(
    (a, b) => Number(b.anclado) - Number(a.anclado) || a.nombre.localeCompare(b.nombre, 'es', { numeric: true })
  );
}

export type LoteSeleccionable<T> = T & { anclado: boolean; actualNoAnclado: boolean };

export interface LotesSeleccionables<T> {
  opciones: Array<LoteSeleccionable<T>>;
  /** El producto tiene lotes anclados: solo se pueden elegir esos. */
  restringido: boolean;
  /** Hay anclajes pero ninguno está disponible (p. ej. todos inactivos). */
  sinDisponibles: boolean;
}

/** Decide qué lotes se pueden elegir para un producto. Sin anclajes: todos.
 *  Con anclajes: solo los anclados disponibles, más (si se pasa) el lote
 *  actual de un ticket ya guardado aunque no esté anclado, marcado como
 *  actualNoAnclado para no perderlo ni forzar su cambio. No muta la entrada. */
export function lotesSeleccionables<T extends { id: string; nombre: string }>(
  lotes: readonly T[],
  loteIdsAnclados: readonly string[],
  loteActualId?: string | null
): LotesSeleccionables<T> {
  const ordenados = ordenarLotesPorAnclaje(lotes, loteIdsAnclados);
  if (loteIdsAnclados.length === 0) {
    return { opciones: ordenados.map(l => ({ ...l, actualNoAnclado: false })), restringido: false, sinDisponibles: false };
  }
  const anclados = ordenados.filter(l => l.anclado).map(l => ({ ...l, actualNoAnclado: false }));
  const actual = loteActualId
    ? ordenados.find(l => !l.anclado && l.id === loteActualId)
    : undefined;
  return {
    opciones: actual ? [...anclados, { ...actual, actualNoAnclado: true }] : anclados,
    restringido: true,
    sinDisponibles: anclados.length === 0,
  };
}
