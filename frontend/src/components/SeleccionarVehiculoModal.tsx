import { useState } from 'react';
import { X, Search, Car, ZoomIn, Check, PencilLine } from 'lucide-react';
import VisorFotos from './VisorFotos';
import type { Vehiculo } from '@shared/types/index.js';

const MAX_TEXTO_TERCERO = 50;

interface Props {
  vehiculos: Vehiculo[];
  /** Id del vehículo del catálogo ya elegido (resalta su tarjeta). */
  elegidoId: string | null;
  /** Texto del vehículo de tercero ya escrito, para precargarlo al editarlo. */
  textoTercero: string;
  onClose: () => void;
  /** null = sin vehículo. */
  onSeleccionar: (vehiculo: Vehiculo | null) => void;
  /** Texto libre de un vehículo de tercero (no se guarda en el catálogo). */
  onSeleccionarTercero: (texto: string) => void;
}

function detalleVehiculo(v: Vehiculo): string {
  return [v.marca, v.modelo, v.color, v.descripcion].filter(Boolean).join(' · ');
}

function coincide(v: Vehiculo, busqueda: string): boolean {
  const q = busqueda.trim().toLowerCase();
  if (!q) return true;
  return [v.placa, v.nombre, v.marca, v.modelo, v.conductor].some(c => c?.toLowerCase().includes(q));
}

/** Selector visual de vehículo, igual en espíritu al de materiales: tarjetas con
 *  foto, placa grande y datos. Tocar la foto la amplía (sin seleccionar); tocar
 *  el resto de la tarjeta selecciona. Incluye la opción de vehículo de tercero
 *  (texto libre que solo se guarda en el ticket). */
function SeleccionarVehiculoModal({ vehiculos, elegidoId, textoTercero, onClose, onSeleccionar, onSeleccionarTercero }: Props) {
  const [busqueda, setBusqueda] = useState('');
  const [terceroAbierto, setTerceroAbierto] = useState(textoTercero !== '');
  const [texto, setTexto] = useState(textoTercero);
  const [visor, setVisor] = useState<{ vehiculo: Vehiculo; indice: number } | null>(null);

  const filtrados = vehiculos.filter(v => coincide(v, busqueda));
  const textoLimpio = texto.trim();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] sm:max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-text-primary">Elegir vehículo</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="p-1 text-text-muted hover:text-text-primary">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 border-b border-border shrink-0 space-y-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar por placa, nombre o chofer..."
              className="w-full pl-9 pr-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onSeleccionar(null)}
              className="px-3 py-2 rounded-lg border border-border bg-surface-alt text-sm text-text-secondary hover:text-text-primary hover:border-brand-400 transition-colors"
            >
              Sin vehículo
            </button>
            <button
              type="button"
              onClick={() => setTerceroAbierto(v => !v)}
              aria-expanded={terceroAbierto}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-colors ${
                terceroAbierto
                  ? 'bg-brand-500 border-brand-500 text-white'
                  : 'bg-surface-alt border-border text-text-secondary hover:text-text-primary hover:border-brand-400'
              }`}
            >
              <PencilLine size={15} />
              Vehículo de tercero (escribir a mano)
            </button>
          </div>
          {terceroAbierto && (
            <div className="rounded-lg border border-border bg-surface-alt p-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={texto}
                  onChange={e => setTexto(e.target.value)}
                  maxLength={MAX_TEXTO_TERCERO}
                  autoFocus
                  placeholder="Placa o descripción del vehículo de tercero"
                  className="flex-1 px-3 py-2.5 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
                />
                <button
                  type="button"
                  disabled={textoLimpio === ''}
                  onClick={() => onSeleccionarTercero(textoLimpio)}
                  className="px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Usar este texto
                </button>
              </div>
              <p className="text-xs text-text-muted mt-2">Solo se guarda en este ticket, no se agrega a la lista de vehículos.</p>
            </div>
          )}
        </div>

        <div className="p-4 overflow-y-auto">
          {filtrados.length === 0 ? (
            <p className="text-center text-text-muted text-sm py-8">
              {vehiculos.length === 0 ? 'No hay vehículos en el catálogo.' : 'Ningún vehículo coincide con la búsqueda.'}
            </p>
          ) : (
            <div className="grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-3 gap-3">
              {filtrados.map(v => {
                const detalle = detalleVehiculo(v);
                const activo = v.id === elegidoId;
                return (
                  <div
                    key={v.id}
                    className={`rounded-xl border overflow-hidden flex flex-col bg-surface ${
                      activo ? 'border-brand-500 ring-2 ring-brand-200' : 'border-border'
                    }`}
                  >
                    {v.fotos[0] ? (
                      <button
                        type="button"
                        onClick={() => setVisor({ vehiculo: v, indice: 0 })}
                        className="relative w-full aspect-[4/3] bg-brand-100"
                        title="Ampliar foto"
                        aria-label={`Ampliar foto de ${v.placa ?? v.nombre}`}
                      >
                        <img src={v.fotos[0]} alt={`Foto de ${v.placa ?? v.nombre}`} loading="lazy" className="w-full h-full object-cover" />
                        <span className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 text-white">
                          <ZoomIn size={14} />
                        </span>
                        {v.fotos.length > 1 && (
                          <span className="absolute bottom-2 right-2 bg-black/60 text-white text-[11px] px-1.5 rounded">
                            {v.fotos.length} fotos
                          </span>
                        )}
                      </button>
                    ) : (
                      <div className="w-full aspect-[4/3] bg-brand-100 flex items-center justify-center text-brand-700">
                        <Car size={36} />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => onSeleccionar(v)}
                      className="flex-1 text-left p-3 hover:bg-surface-hover transition-colors"
                    >
                      <p className="text-lg font-bold tracking-wide text-text-primary truncate">{v.placa ?? v.nombre}</p>
                      {v.placa && <p className="text-sm text-text-secondary truncate">{v.nombre}</p>}
                      {detalle && <p className="text-xs text-text-muted truncate">{detalle}</p>}
                      {v.conductor && <p className="text-xs text-text-muted truncate">Chofer: {v.conductor}</p>}
                      <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700">
                        <Check size={14} />
                        {activo ? 'Seleccionado' : 'Seleccionar'}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {visor && (
        <VisorFotos
          fotos={visor.vehiculo.fotos}
          indice={visor.indice}
          onCambiar={indice => setVisor({ vehiculo: visor.vehiculo, indice })}
          onCerrar={() => setVisor(null)}
          alt={`Foto ampliada de ${visor.vehiculo.placa ?? visor.vehiculo.nombre}`}
        />
      )}
    </div>
  );
}

export default SeleccionarVehiculoModal;
