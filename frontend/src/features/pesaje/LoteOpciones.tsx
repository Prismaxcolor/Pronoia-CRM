import type { Lote } from '@shared/types/index.js';
import { lotesSeleccionables } from '@shared/types/lote.js';

interface Props {
  lotes: Lote[];
  /** Lotes anclados del producto elegido. Si hay, solo se pueden elegir esos (★). */
  loteIdsPosibles: string[];
  /** Lote ya guardado en el ticket: se conserva como opción aunque no esté anclado. */
  loteActualId?: string | null;
}

/** <option>s de un <select> de destino/origen. Con lotes anclados al producto
 *  solo salen esos (★); sin anclajes, todos. */
function LoteOpciones({ lotes, loteIdsPosibles, loteActualId }: Props) {
  const { opciones, restringido, sinDisponibles } = lotesSeleccionables(lotes, loteIdsPosibles, loteActualId);
  return (
    <>
      {sinDisponibles && <option value="" disabled>Sin lotes anclados disponibles</option>}
      {opciones.map(l => (
        <option key={l.id} value={l.id}>
          {restringido && l.anclado ? '★ ' : ''}{l.nombre}{l.actualNoAnclado ? ' (actual, no anclado)' : ''}
        </option>
      ))}
    </>
  );
}

export default LoteOpciones;
