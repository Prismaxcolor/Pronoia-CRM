import { useState } from 'react';
import { X, User, Search } from 'lucide-react';

interface EntidadConFoto {
  id: string;
  nombre: string;
  fotoUrl?: string | null;
}

interface Props<T extends EntidadConFoto> {
  titulo: string;
  entidades: T[];
  onClose: () => void;
  onSeleccionar: (entidadId: string) => void;
}

/** Selector visual con foto: mismo patrón que SeleccionarMaterialModal de
 *  Pesaje, generalizado a cualquier entidad con {id, nombre, fotoUrl}
 *  (cliente, proveedor). No reemplaza el <select>, conviven ambos. */
function SeleccionarEntidadModal<T extends EntidadConFoto>({ titulo, entidades, onClose, onSeleccionar }: Props<T>) {
  const [busqueda, setBusqueda] = useState('');

  const filtrados = entidades.filter(e =>
    e.nombre.toLowerCase().includes(busqueda.trim().toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-text-primary">{titulo}</h2>
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
              placeholder="Buscar..."
              className="w-full pl-9 pr-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
            />
          </div>
        </div>

        <div className="p-4 overflow-y-auto">
          {filtrados.length === 0 ? (
            <p className="text-center text-text-muted text-sm py-8">Nadie coincide con la búsqueda.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {filtrados.map(e => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onSeleccionar(e.id)}
                  className="text-left rounded-xl border border-border overflow-hidden hover:border-brand-400 hover:ring-2 hover:ring-brand-100 transition-all"
                >
                  <div className="w-full aspect-square bg-brand-100 flex items-center justify-center text-brand-700">
                    {e.fotoUrl ? (
                      <img src={e.fotoUrl} alt={e.nombre} loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <User size={28} />
                    )}
                  </div>
                  <p className="text-xs text-text-primary p-2 truncate">{e.nombre}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SeleccionarEntidadModal;
