import type { Lote } from '@shared/types/index.js';
import { lotesSeleccionables } from '../../../../shared/types/lote.js';

export interface EntidadDestinoLote {
  id: string;
  nombre: string;
  fotos: string[];
  /** Lote anclado al material (★). */
  destacado: boolean;
  detalle: string;
}

/** Lotes elegibles como destino/origen, en el formato del selector visual
 *  (SeleccionarEntidadModal). Mismas reglas que lotesSeleccionables: con
 *  anclajes solo los anclados (+ el lote actual de un ticket guardado). */
export function entidadesDestinoLote(
  lotes: readonly Lote[],
  loteIdsPosibles: readonly string[],
  loteActualId?: string | null
): { entidades: EntidadDestinoLote[]; hayAnclados: boolean; sinDisponibles: boolean } {
  const { opciones, restringido, sinDisponibles } = lotesSeleccionables(lotes, loteIdsPosibles, loteActualId);
  return {
    entidades: opciones.map(l => ({
      id: l.id,
      nombre: l.actualNoAnclado ? `${l.nombre} (actual, no anclado)` : l.nombre,
      fotos: l.fotos ?? [],
      destacado: restringido && l.anclado,
      detalle: `Stock: ${l.stockKg.toFixed(2)} kg`,
    })),
    hayAnclados: restringido,
    sinDisponibles,
  };
}

/** Nombre del lote elegido, o null si no hay (o no existe en la lista). */
export function nombreDestinoLote(lotes: readonly Lote[], loteId: string): string | null {
  return lotes.find(l => l.id === loteId)?.nombre ?? null;
}
