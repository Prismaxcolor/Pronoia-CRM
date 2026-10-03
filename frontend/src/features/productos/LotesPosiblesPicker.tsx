import { useState } from 'react';
import { Search, Check } from 'lucide-react';
import type { Lote } from '@shared/types/index.js';

interface Props {
  lotes: Lote[];
  seleccionados: string[];
  onChange: (ids: string[]) => void;
}

/** Multi-selección con buscador de los lotes posibles de un producto. Sin
 *  selección el producto no pertenece a ningún lote. */
function LotesPosiblesPicker({ lotes, seleccionados, onChange }: Props) {
  const [busqueda, setBusqueda] = useState('');
  const q = busqueda.trim().toLowerCase();
  const visibles = lotes.filter(l => l.nombre.toLowerCase().includes(q));

  const alternar = (id: string) =>
    onChange(seleccionados.includes(id) ? seleccionados.filter(x => x !== id) : [...seleccionados, id]);

  return (
    <div className="border border-border rounded-lg p-3 space-y-2">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="search"
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar lote..."
          className="w-full pl-8 pr-3 py-1.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
        />
      </div>
      {lotes.length === 0 ? (
        <p className="text-xs text-text-muted">No hay lotes disponibles.</p>
      ) : visibles.length === 0 ? (
        <p className="text-xs text-text-muted">Ningún lote coincide.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
          {visibles.map(l => {
            const activo = seleccionados.includes(l.id);
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => alternar(l.id)}
                aria-pressed={activo}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  activo
                    ? 'bg-brand-500 border-brand-500 text-white'
                    : 'bg-surface-alt border-border text-text-muted hover:text-text-primary'
                }`}
              >
                {activo && <Check size={12} />}
                {l.nombre}{!l.activo ? ' (inactivo)' : ''}
              </button>
            );
          })}
        </div>
      )}
      <p className="text-xs text-text-muted">
        {seleccionados.length === 0
          ? 'Sin lotes: este producto no pertenece a ningún lote.'
          : `${seleccionados.length} lote${seleccionados.length > 1 ? 's' : ''} posible${seleccionados.length > 1 ? 's' : ''}.`}
      </p>
    </div>
  );
}

export default LotesPosiblesPicker;
