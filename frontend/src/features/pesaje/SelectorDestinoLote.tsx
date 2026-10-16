import { useMemo, useState } from 'react';
import { ChevronDown, Boxes } from 'lucide-react';
import type { Lote } from '@shared/types/index.js';
import SeleccionarEntidadModal from '../../components/SeleccionarEntidadModal';
import AvisoSinLotesAnclados from './AvisoSinLotesAnclados';
import { entidadesDestinoLote } from './lote-destino';

interface Props {
  lotes: Lote[];
  /** Lotes anclados del material elegido. Si hay, solo se pueden elegir esos (★). */
  loteIdsPosibles: string[];
  /** Id del lote elegido, o '' si aún no hay. También se conserva como opción
   *  si es el lote actual de un ticket guardado aunque no esté anclado. */
  valor: string;
  onChange: (loteId: string) => void;
  titulo?: string;
}

/** Selector visual de lote destino de inventario: botón con miniatura + nombre
 *  que abre un panel de tarjetas con foto (SeleccionarEntidadModal). Mismas
 *  reglas que el <select> anterior (lotes anclados excluyen al resto, lote
 *  actual visible), solo cambia la presentación. */
function SelectorDestinoLote({ lotes, loteIdsPosibles, valor, onChange, titulo = 'Destino (inventario)' }: Props) {
  const [abierto, setAbierto] = useState(false);
  const { entidades, sinDisponibles } = useMemo(
    () => entidadesDestinoLote(lotes, loteIdsPosibles, valor),
    [lotes, loteIdsPosibles, valor]
  );
  const elegido = lotes.find(l => l.id === valor);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm flex items-center gap-2 text-left focus:outline-none focus:ring-2 focus:ring-brand-400"
      >
        <span className="w-8 h-8 rounded-md bg-brand-100 text-brand-700 flex items-center justify-center overflow-hidden shrink-0">
          {elegido?.fotos?.[0] ? (
            <img src={elegido.fotos[0]} alt={elegido.nombre} className="w-full h-full object-cover" />
          ) : (
            <Boxes size={16} />
          )}
        </span>
        <span className={`flex-1 truncate ${elegido ? 'text-text-primary' : 'text-text-muted'}`}>
          {elegido?.nombre ?? '— Selecciona —'}
        </span>
        <ChevronDown size={14} className="text-text-muted shrink-0" />
      </button>
      <AvisoSinLotesAnclados lotes={lotes} loteIdsPosibles={loteIdsPosibles} />
      {abierto && (
        <SeleccionarEntidadModal
          titulo={titulo}
          entidades={entidades}
          seleccionadoId={valor || undefined}
          ampliarFotos
          etiquetaDestacados="Lotes posibles de este material"
          mensajeVacio={sinDisponibles ? 'Los lotes anclados a este material no están disponibles (inactivos). Reactívalos o cambia el anclaje en Productos.' : undefined}
          onClose={() => setAbierto(false)}
          onSeleccionar={id => { onChange(id); setAbierto(false); }}
        />
      )}
    </>
  );
}

export default SelectorDestinoLote;
