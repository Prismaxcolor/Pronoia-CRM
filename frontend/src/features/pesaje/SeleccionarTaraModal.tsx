import { useState } from 'react';
import { X, Weight, Search } from 'lucide-react';
import type { Tara } from '@shared/types/index.js';

interface Props {
  taras: Tara[];
  onClose: () => void;
  onSeleccionar: (taraId: string) => void;
}

/** Selector visual de tara preconfigurada: mismo patrón que
 *  SeleccionarMaterialModal — grilla con foto, nombre y peso, con buscador. */
function SeleccionarTaraModal({ taras, onClose, onSeleccionar }: Props) {
  const [busqueda, setBusqueda] = useState('');

  const filtradas = taras.filter(t =>
    t.nombre.toLowerCase().includes(busqueda.trim().toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-text-primary">Elegir tara</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 border-b border-border shrink-0">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar tara..."
              className="w-full pl-9 pr-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
            />
          </div>
        </div>

        <div className="p-4 overflow-y-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3 pb-3 border-b border-border">
            <button
              type="button"
              onClick={() => onSeleccionar('')}
              className="text-left rounded-xl border border-dashed border-border overflow-hidden hover:border-red-400 hover:ring-2 hover:ring-red-100 transition-all"
            >
              <div className="w-full aspect-square bg-surface-alt flex items-center justify-center text-text-muted">
                <X size={28} />
              </div>
              <div className="p-2">
                <p className="text-xs text-text-primary truncate">Sin tara</p>
                <p className="text-[11px] text-text-muted">Pesaje sin tara</p>
              </div>
            </button>
          </div>

          {filtradas.length === 0 ? (
            <p className="text-center text-text-muted text-sm py-8">Ninguna tara coincide con la búsqueda.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {filtradas.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSeleccionar(t.id)}
                  className="text-left rounded-xl border border-border overflow-hidden hover:border-brand-400 hover:ring-2 hover:ring-brand-100 transition-all"
                >
                  <div className="w-full aspect-square bg-brand-100 flex items-center justify-center text-brand-700">
                    {t.foto ? (
                      <img src={t.foto} alt={t.nombre} loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <Weight size={28} />
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-xs text-text-primary truncate">{t.nombre}</p>
                    <p className="text-[11px] text-text-muted">{t.peso} kg</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SeleccionarTaraModal;
