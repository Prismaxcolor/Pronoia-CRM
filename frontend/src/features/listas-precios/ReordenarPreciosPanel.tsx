import { useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { moverElemento } from '../../lib/orden-precios';
import type { PrecioLista } from '@shared/types/index.js';

interface Props {
  precios: PrecioLista[];
  /** Recibe la lista completa en el nuevo orden; el padre la guarda. */
  onReordenar: (nuevos: PrecioLista[]) => void;
}

const BOTON = 'p-1.5 rounded-md text-text-muted hover:bg-surface-alt disabled:opacity-30 disabled:hover:bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

/** Lista arrastrable (ratón/táctil con arrastre nativo) con botones subir/bajar para teclado. */
function ReordenarPreciosPanel({ precios, onReordenar }: Props) {
  const [arrastrando, setArrastrando] = useState<number | null>(null);
  const [sobre, setSobre] = useState<number | null>(null);

  const mover = (desde: number, hacia: number) => onReordenar(moverElemento(precios, desde, hacia));
  const nombre = (p: PrecioLista) => p.nombreProducto ?? p.productoId;

  const soltar = (destino: number) => {
    if (arrastrando !== null) mover(arrastrando, destino);
    setArrastrando(null);
    setSobre(null);
  };

  return (
    <ul className="bg-surface rounded-xl border border-border divide-y divide-border" aria-label="Orden de los materiales">
      {precios.map((p, i) => (
        <li
          key={p.id}
          draggable
          onDragStart={() => setArrastrando(i)}
          onDragOver={e => { e.preventDefault(); setSobre(i); }}
          onDrop={e => { e.preventDefault(); soltar(i); }}
          onDragEnd={() => { setArrastrando(null); setSobre(null); }}
          className={`flex items-center gap-2 px-3 py-2 cursor-grab ${arrastrando === i ? 'opacity-40' : ''} ${sobre === i && arrastrando !== i ? 'bg-brand-50' : ''}`}
        >
          <GripVertical size={16} className="text-text-muted shrink-0" aria-hidden="true" />
          <span className="flex-1 text-sm font-medium text-text-primary">{nombre(p)}</span>
          <button type="button" className={BOTON} disabled={i === 0} onClick={() => mover(i, i - 1)} aria-label={`Subir ${nombre(p)}`}>
            <ArrowUp size={15} />
          </button>
          <button type="button" className={BOTON} disabled={i === precios.length - 1} onClick={() => mover(i, i + 1)} aria-label={`Bajar ${nombre(p)}`}>
            <ArrowDown size={15} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export default ReordenarPreciosPanel;
