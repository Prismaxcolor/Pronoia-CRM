import type { Lote } from '@shared/types/index.js';
import { lotesSeleccionables } from '@shared/types/lote.js';

interface Props {
  lotes: Lote[];
  loteIdsPosibles: string[];
}

/** Aviso cuando el producto tiene lotes anclados pero ninguno está disponible
 *  (p. ej. todos inactivos): evita un selector vacío sin explicación. */
function AvisoSinLotesAnclados({ lotes, loteIdsPosibles }: Props) {
  if (!lotesSeleccionables(lotes, loteIdsPosibles).sinDisponibles) return null;
  return (
    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-1">
      Los lotes anclados a este material no están disponibles (inactivos). Reactívalos o cambia el anclaje en Productos.
    </p>
  );
}

export default AvisoSinLotesAnclados;
