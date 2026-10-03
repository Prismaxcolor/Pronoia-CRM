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
  composicion: ComposicionPCBItem[];
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
}

/** Destino de inventario de una línea de pesaje: MPP o un lote concreto. */
export type DestinoTipo = 'mpp' | 'lote';

/** Etiqueta legible de un destino: "Sin lote" (el material nunca se asignó
 *  a un lote — el caso normal de Ferroso/No Ferroso, categorías que no
 *  usan lotes) o el nombre del lote. */
export function destinoLabel(destinoTipo: DestinoTipo, nombreLote?: string | null): string {
  return destinoTipo === 'lote' ? (nombreLote ?? 'Lote') : 'Sin lote';
}
