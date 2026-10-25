import { useState, type ReactNode } from 'react';
import Modal from './Modal';
import { X, User, Search, Check, Maximize2 } from 'lucide-react';
import VisorFotos from './VisorFotos';

interface EntidadConFoto {
  id: string;
  nombre: string;
  fotos?: string[];
  /** Si es true se muestra marcada y agrupada primero (ej. lotes posibles de un producto). */
  destacado?: boolean;
  /** Línea secundaria bajo el nombre (ej. stock de un lote). */
  detalle?: string;
}

interface Props<T extends EntidadConFoto> {
  titulo: string;
  entidades: T[];
  onClose: () => void;
  onSeleccionar: (entidadId: string) => void;
  /** Texto del grupo de entidades destacadas (por defecto "Sugeridos"). */
  etiquetaDestacados?: string;
  /** Mensaje cuando no hay ninguna entidad que mostrar (en vez de la búsqueda vacía). */
  mensajeVacio?: string;
  /** Entidad ya elegida: se resalta con una marca. */
  seleccionadoId?: string;
  /** Si es true, las entidades con varias fotos muestran un botón para ampliarlas
   *  en el visor sin seleccionar; con una sola foto no hace falta. */
  ampliarFotos?: boolean;
  /** Reemplaza el ícono genérico cuando la entidad no tiene foto (ej. inicial sobre el color de una cuenta). */
  renderSinFoto?: (entidad: T) => ReactNode;
  /** 'compacto' limita la imagen de cada tarjeta (selector de cuentas); 'normal' la deja cuadrada (materiales de pesaje). */
  tamanoTarjeta?: 'normal' | 'compacto';
}

/** Selector visual con foto: mismo patrón que SeleccionarMaterialModal de
 *  Pesaje, generalizado a cualquier entidad con {id, nombre, fotos}
 *  (cliente, proveedor, lote). No reemplaza el <select>, conviven ambos. */
function SeleccionarEntidadModal<T extends EntidadConFoto>({ titulo, entidades, onClose, onSeleccionar, etiquetaDestacados = 'Sugeridos', mensajeVacio, seleccionadoId, ampliarFotos = false, renderSinFoto, tamanoTarjeta = 'normal' }: Props<T>) {
  const [busqueda, setBusqueda] = useState('');
  const [visor, setVisor] = useState<{ fotos: string[]; indice: number; nombre: string } | null>(null);
  // Escape cierra primero el visor de fotos (que atiende su propia tecla) y luego este selector, sin tocar el modal padre.
  const claseImagen = tamanoTarjeta === 'compacto' ? 'aspect-[4/3] max-h-28' : 'aspect-square';
  const columnas = tamanoTarjeta === 'compacto' ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3';

  const filtrados = entidades.filter(e =>
    e.nombre.toLowerCase().includes(busqueda.trim().toLowerCase())
  );

  const hayDestacados = filtrados.some(e => e.destacado);
  const destacados = filtrados.filter(e => e.destacado);
  const resto = filtrados.filter(e => !e.destacado);

  const tarjeta = (e: T) => {
    const esActual = e.id === seleccionadoId;
    const puedeAmpliar = ampliarFotos && (e.fotos?.length ?? 0) > 1;
    const borde = esActual ? 'border-brand-600 ring-2 ring-brand-300' : e.destacado ? 'border-brand-400 ring-1 ring-brand-100' : 'border-border';
    return (
      <div
        key={e.id}
        className={`relative rounded-xl border overflow-hidden hover:border-brand-400 hover:ring-2 hover:ring-brand-100 transition-all ${borde}`}
      >
        <button type="button" onClick={() => onSeleccionar(e.id)} className="block w-full text-left">
          <div className={`w-full ${claseImagen} bg-brand-100 flex items-center justify-center text-brand-700`}>
            {e.fotos?.[0] ? (
              <img src={e.fotos[0]} alt={e.nombre} loading="lazy" decoding="async" className="w-full h-full object-cover" />
            ) : (
              renderSinFoto ? renderSinFoto(e) : <User size={28} />
            )}
          </div>
          <div className="p-2">
            <p className="text-xs text-text-primary line-clamp-2 break-words" title={e.nombre}>{e.destacado ? '★ ' : ''}{e.nombre}</p>
            {e.detalle && <p className="text-[11px] text-text-muted line-clamp-2 break-words" title={e.detalle}>{e.detalle}</p>}
          </div>
        </button>
        {esActual && (
          <span className="absolute top-1.5 left-1.5 bg-brand-600 text-white rounded-full p-1 pointer-events-none">
            <Check size={12} />
          </span>
        )}
        {puedeAmpliar && (
          <button
            type="button"
            aria-label={`Ampliar fotos de ${e.nombre}`}
            onClick={() => setVisor({ fotos: e.fotos ?? [], indice: 0, nombre: e.nombre })}
            className="absolute top-1.5 right-1.5 bg-black/55 text-white rounded-full p-2 hover:bg-black/75"
          >
            <Maximize2 size={14} />
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      <Modal onClose={onClose} bloqueado={visor !== null} panelClassName="bg-surface rounded-2xl shadow-xl w-full max-w-2xl max-h-[85dvh] flex flex-col">
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
          {entidades.length === 0 && mensajeVacio ? (
            <p className="text-center text-amber-700 text-sm py-8">{mensajeVacio}</p>
          ) : filtrados.length === 0 ? (
            <p className="text-center text-text-muted text-sm py-8">Nadie coincide con la búsqueda.</p>
          ) : (
            <>
              {hayDestacados && (
                <>
                  <p className="text-xs font-semibold text-brand-700 mb-2">{etiquetaDestacados}</p>
                  <div className={`grid ${columnas} gap-3 mb-4`}>{destacados.map(tarjeta)}</div>
                  {resto.length > 0 && <p className="text-xs font-semibold text-text-muted mb-2">Otros</p>}
                </>
              )}
              <div className={`grid ${columnas} gap-3`}>{resto.map(tarjeta)}</div>
            </>
          )}
        </div>
      </Modal>
      {visor && (
        <VisorFotos
          fotos={visor.fotos}
          indice={visor.indice}
          onCambiar={i => setVisor(v => (v ? { ...v, indice: i } : v))}
          onCerrar={() => setVisor(null)}
          pie={visor.nombre}
        />
      )}
    </>
  );
}

export default SeleccionarEntidadModal;
