import { useState } from 'react';
import { buscarVehiculoPorTexto, etiquetaVehiculo } from '../lib/vehiculo';
import VehiculoResumen from './VehiculoResumen';
import type { Vehiculo } from '@shared/types/index.js';

/** Valor del <select> que activa el campo de texto libre (vehículo de tercero). */
export const OPCION_TERCERO = '__tercero__';

interface Props {
  /** Texto que se guarda en el ticket ("PLACA · nombre" o texto libre de tercero). */
  value: string;
  onChange: (valor: string) => void;
  /** Vehículos activos del catálogo del sistema. */
  vehiculos: Vehiculo[];
  inputClass: string;
  labelClass: string;
}

/**
 * Selector de vehículo: elige uno del catálogo (se muestra "placa · nombre" y,
 * debajo, su miniatura con visor de fotos) o "Vehículo de tercero", que deja
 * escribir placa/descripción a mano. El tercero solo se guarda como texto en
 * el ticket; nunca se crea en el catálogo de vehículos. Los tickets antiguos
 * que guardaron solo el nombre siguen reconociéndose.
 */
function VehiculoSelector({ value, onChange, vehiculos, inputClass, labelClass }: Props) {
  const [terceroForzado, setTerceroForzado] = useState(false);
  const elegido = buscarVehiculoPorTexto(value, vehiculos);
  const esTercero = terceroForzado || (value.trim() !== '' && !elegido);
  const valorSelect = esTercero ? OPCION_TERCERO : elegido ? etiquetaVehiculo(elegido) : '';

  const handleSelect = (nuevo: string) => {
    if (nuevo === OPCION_TERCERO) {
      setTerceroForzado(true);
      if (elegido) onChange('');
      return;
    }
    setTerceroForzado(false);
    onChange(nuevo);
  };

  return (
    <div>
      <label className={labelClass}>Vehículo</label>
      <select value={valorSelect} onChange={e => handleSelect(e.target.value)} className={inputClass}>
        <option value="">— Sin vehículo —</option>
        {vehiculos.map(v => (
          <option key={v.id} value={etiquetaVehiculo(v)}>
            {etiquetaVehiculo(v)}
          </option>
        ))}
        <option value={OPCION_TERCERO}>Vehículo de tercero (escribir a mano)</option>
      </select>
      {!esTercero && elegido && <VehiculoResumen vehiculo={elegido} />}
      {esTercero && (
        <div className="mt-1.5">
          <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            maxLength={50}
            className={`${inputClass} text-xs py-1.5`}
            placeholder="Placa o descripción del vehículo de tercero"
          />
          <p className="text-xs text-text-muted mt-1">Solo se guarda en este ticket, no se agrega a la lista de vehículos.</p>
        </div>
      )}
    </div>
  );
}

export default VehiculoSelector;
