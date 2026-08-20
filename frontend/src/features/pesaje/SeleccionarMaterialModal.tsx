import { useState } from 'react';
import { X, Package, Search } from 'lucide-react';
import type { Producto } from '@shared/types/index.js';

interface Props {
  productos: Producto[];
  onClose: () => void;
  onSeleccionar: (productoId: string) => void;
}

/** Selector visual de material: alternativa al <select> de texto para cuando
 *  es más rápido reconocer el material por foto que por nombre. No reemplaza
 *  el <select>, conviven ambos — este solo escribe el mismo productoId que
 *  escribiría el <select>. */
function SeleccionarMaterialModal({ productos, onClose, onSeleccionar }: Props) {
  const [busqueda, setBusqueda] = useState('');
  const [categoriaId, setCategoriaId] = useState<string | null>(null);

  const categorias = Array.from(
    productos.reduce((map, p) => {
      if (p.tipoMaterialId && p.tipoMaterialNombre && !map.has(p.tipoMaterialId)) {
        map.set(p.tipoMaterialId, p.tipoMaterialNombre);
      }
      return map;
    }, new Map<string, string>())
  ).sort((a, b) => a[1].localeCompare(b[1]));

  const filtrados = productos.filter(p =>
    p.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()) &&
    (categoriaId === null || p.tipoMaterialId === categoriaId)
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-text-primary">Elegir material</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 border-b border-border shrink-0">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              autoFocus
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar material..."
              className="w-full pl-9 pr-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
            />
          </div>

          {categorias.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              <button
                type="button"
                onClick={() => setCategoriaId(null)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  categoriaId === null
                    ? 'bg-brand-500 border-brand-500 text-white'
                    : 'bg-surface-alt border-border text-text-muted hover:text-text-primary'
                }`}
              >
                Todas
              </button>
              {categorias.map(([id, nombre]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCategoriaId(id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    categoriaId === id
                      ? 'bg-brand-500 border-brand-500 text-white'
                      : 'bg-surface-alt border-border text-text-muted hover:text-text-primary'
                  }`}
                >
                  {nombre}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 overflow-y-auto">
          {filtrados.length === 0 ? (
            <p className="text-center text-text-muted text-sm py-8">Ningún material coincide con la búsqueda.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {filtrados.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSeleccionar(p.id)}
                  className="text-left rounded-xl border border-border overflow-hidden hover:border-brand-400 hover:ring-2 hover:ring-brand-100 transition-all"
                >
                  <div className="w-full aspect-square bg-brand-100 flex items-center justify-center text-brand-700">
                    {p.imagenUrl ? (
                      <img src={p.imagenUrl} alt={p.nombre} loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <Package size={28} />
                    )}
                  </div>
                  <p className="text-xs text-text-primary p-2 truncate">{p.nombre}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SeleccionarMaterialModal;
