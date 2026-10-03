import type { Lote } from '@shared/types/index.js';
import { ordenarLotesPorAnclaje } from '@shared/types/lote.js';

interface Props {
  lotes: Lote[];
  /** Lotes posibles (anclados) del producto elegido; salen primero y marcados. */
  loteIdsPosibles: string[];
}

/** <option>s de un <select> de destino/origen: primero los lotes posibles del
 *  producto, luego el resto (ningún lote se bloquea). */
function LoteOpciones({ lotes, loteIdsPosibles }: Props) {
  const ordenados = ordenarLotesPorAnclaje(lotes, loteIdsPosibles);
  const posibles = ordenados.filter(l => l.anclado);
  const otros = ordenados.filter(l => !l.anclado);
  if (posibles.length === 0) {
    return <>{otros.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}</>;
  }
  return (
    <>
      <optgroup label="Lotes posibles de este material">
        {posibles.map(l => <option key={l.id} value={l.id}>★ {l.nombre}</option>)}
      </optgroup>
      <optgroup label="Otros lotes">
        {otros.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
      </optgroup>
    </>
  );
}

export default LoteOpciones;
