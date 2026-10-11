import type { OpcionLotePacking } from '@shared/types/index.js';
import { claveOpcionLote, etiquetaOpcionLote, opcionDeFila } from '../../lib/lotes-packing';

/** Lo que cambia en la fila al elegir un lote: texto del lote, almacén y (si el lote lo tiene) su color predeterminado. */
export interface EleccionLote {
  lote: string;
  almacenId: string;
  color: string | null;
}

interface Props {
  lote: string;
  almacenId: string;
  opciones: readonly OpcionLotePacking[];
  disabled: boolean;
  etiqueta: string;
  className: string;
  onElegir: (e: EleccionLote) => void;
}

/** Valor reservado para el lote que ya estaba guardado y no coincide con ninguna opción actual (se conserva tal cual). */
const GUARDADO = '__guardado__';

/**
 * Selector de lote de exportación. Cada opción es un lote en un almacén, con los kg disponibles (CONTROL INTERNO:
 * solo se ve aquí, no sale en los PDF). Un lote escrito en un packing list anterior se conserva y se muestra.
 */
function PackingListLoteSelect({ lote, almacenId, opciones, disabled, etiqueta, className, onElegir }: Props) {
  const actual = opcionDeFila(opciones, lote, almacenId || null);
  const hayGuardadoSinOpcion = lote.trim() !== '' && actual === null;
  const valor = actual ? claveOpcionLote(actual) : hayGuardadoSinOpcion ? GUARDADO : '';

  const cambiar = (v: string) => {
    if (v === GUARDADO) return;
    const o = opciones.find(x => claveOpcionLote(x) === v);
    onElegir(o
      ? { lote: o.valor, almacenId: o.almacenId ?? '', color: o.colorPredeterminado }
      : { lote: '', almacenId: '', color: null });
  };

  return (
    <select aria-label={etiqueta} value={valor} disabled={disabled} onChange={e => cambiar(e.target.value)} className={className}>
      <option value="">— Elige un lote —</option>
      {hayGuardadoSinOpcion && <option value={GUARDADO}>{lote.trim()} (guardado antes)</option>}
      {opciones.map(o => <option key={claveOpcionLote(o)} value={claveOpcionLote(o)}>{etiquetaOpcionLote(o)}</option>)}
    </select>
  );
}

export default PackingListLoteSelect;
