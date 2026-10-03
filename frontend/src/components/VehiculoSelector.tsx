import { useState } from 'react';
import { Car, Pencil } from 'lucide-react';
import { buscarVehiculoPorTexto, etiquetaVehiculo } from '../lib/vehiculo';
import VehiculoResumen from './VehiculoResumen';
import SeleccionarVehiculoModal from './SeleccionarVehiculoModal';
import type { Vehiculo } from '@shared/types/index.js';

interface Props {
  /** Texto que se guarda en el ticket ("PLACA · nombre" o texto libre de tercero). */
  value: string;
  onChange: (valor: string) => void;
  /** Vehículos activos del catálogo del sistema. */
  vehiculos: Vehiculo[];
  /** Se conservan por compatibilidad con los formularios; el selector visual usa sus propios estilos. */
  inputClass?: string;
  labelClass: string;
}

/**
 * Selector de vehículo: un botón abre un modal con tarjetas del catálogo
 * (foto, placa, nombre, datos; buscador; tocar la foto la amplía) y la opción
 * "Vehículo de tercero", que deja escribir placa/descripción a mano. El tercero
 * solo se guarda como texto en el ticket; nunca se crea en el catálogo de
 * vehículos. Los tickets antiguos que guardaron solo el nombre siguen
 * reconociéndose.
 */
function VehiculoSelector({ value, onChange, vehiculos, labelClass }: Props) {
  const [modalAbierto, setModalAbierto] = useState(false);
  const elegido = buscarVehiculoPorTexto(value, vehiculos);
  const textoTercero = !elegido ? value.trim() : '';

  const cerrarYAplicar = (nuevo: string) => {
    onChange(nuevo);
    setModalAbierto(false);
  };

  const botonAbrir = (texto: string, conIcono: boolean) => (
    <button
      type="button"
      onClick={() => setModalAbierto(true)}
      className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-surface-alt text-sm text-text-primary hover:border-brand-400 hover:ring-2 hover:ring-brand-100 transition-all"
    >
      {conIcono && <Car size={16} className="text-brand-700 shrink-0" />}
      {texto}
    </button>
  );

  return (
    <div>
      <label className={labelClass}>Vehículo</label>
      {elegido ? (
        <>
          <VehiculoResumen vehiculo={elegido} />
          <div className="flex gap-2 mt-1.5">{botonAbrir('Cambiar vehículo', false)}</div>
        </>
      ) : textoTercero ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-surface-alt text-sm text-text-primary min-w-0">
            <Pencil size={14} className="text-text-muted shrink-0" />
            <span className="truncate">{textoTercero}</span>
            <span className="text-xs text-text-muted shrink-0">(tercero)</span>
          </div>
          {botonAbrir('Cambiar vehículo', false)}
        </div>
      ) : (
        botonAbrir('Elegir vehículo (sin vehículo)', true)
      )}

      {modalAbierto && (
        <SeleccionarVehiculoModal
          vehiculos={vehiculos}
          elegidoId={elegido?.id ?? null}
          textoTercero={textoTercero}
          onClose={() => setModalAbierto(false)}
          onSeleccionar={v => cerrarYAplicar(v ? etiquetaVehiculo(v) : '')}
          onSeleccionarTercero={cerrarYAplicar}
        />
      )}
    </div>
  );
}

export default VehiculoSelector;
