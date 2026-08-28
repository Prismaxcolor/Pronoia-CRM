/**
 * Lote — destino de inventario gestionado (Lote 1, Lote 2, ...). Junto con MPP
 * (Material Por Procesar), define dónde se acumula el stock de cada material
 * pesado en un ticket.
 */
export interface Lote {
  id: string;
  nombre: string;
  activo: boolean;
  /** Almacén donde está físicamente este lote (Fase 0 de Toma física de inventario). */
  almacenId: string;
  /** Nombre del almacén, resuelto vía join. Solo lectura (no se envía). */
  almacenNombre?: string | null;
  /** ISO timestamp (created_at en BD). */
  createdAt: string;
  /** Kg reales en este lote ahora mismo (Bloque 40: stock_lote_total). Suma
   *  compras/traslados directos a este lote y salidas de transformaciones que
   *  lo alimentaron, menos ventas directas y retiros de transformaciones que
   *  lo usaron como origen. */
  stockKg: number;
}

/** Destino de inventario de una línea de pesaje: MPP o un lote concreto. */
export type DestinoTipo = 'mpp' | 'lote';

/** Etiqueta legible de un destino: "MPP" o el nombre del lote. */
export function destinoLabel(destinoTipo: DestinoTipo, nombreLote?: string | null): string {
  return destinoTipo === 'lote' ? (nombreLote ?? 'Lote') : 'MPP';
}
