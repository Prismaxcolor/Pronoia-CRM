/**
 * Lote — destino de inventario gestionado (Lote 1, Lote 2, ...). Junto con MPP
 * (Material Por Procesar), define dónde se acumula el stock de cada material
 * pesado en un ticket.
 */
export interface Lote {
  id: string;
  nombre: string;
  activo: boolean;
  /** ISO timestamp (created_at en BD). */
  createdAt: string;
}

/** Destino de inventario de una línea de pesaje: MPP o un lote concreto. */
export type DestinoTipo = 'mpp' | 'lote';

/** Etiqueta legible de un destino: "MPP" o el nombre del lote. */
export function destinoLabel(destinoTipo: DestinoTipo, nombreLote?: string | null): string {
  return destinoTipo === 'lote' ? (nombreLote ?? 'Lote') : 'MPP';
}
