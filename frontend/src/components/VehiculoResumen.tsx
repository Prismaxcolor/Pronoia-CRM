import { useState } from 'react';
import { Car, ZoomIn } from 'lucide-react';
import VisorFotos from './VisorFotos';
import type { Vehiculo } from '@shared/types/index.js';

interface Props {
  vehiculo: Vehiculo;
}

/** Datos secundarios del vehículo en una sola línea ("Hino · Rojo · Chofer: Juan"). */
function detalleVehiculo(v: Vehiculo): string {
  return [v.marca, v.modelo, v.color, v.conductor ? `Chofer: ${v.conductor}` : null, v.descripcion]
    .filter(Boolean)
    .join(' · ');
}

/** Tarjeta compacta de un vehículo del catálogo: miniatura, placa, nombre y
 *  datos. Si tiene fotos, tocar la miniatura abre el visor a pantalla completa
 *  (flechas, teclado y deslizamiento). */
function VehiculoResumen({ vehiculo }: Props) {
  const [indiceVisor, setIndiceVisor] = useState<number | null>(null);
  const portada = vehiculo.fotos[0];
  const detalle = detalleVehiculo(vehiculo);

  return (
    <div className="flex items-center gap-3 mt-1.5 p-2 rounded-lg border border-border bg-surface-alt">
      {portada ? (
        <button
          type="button"
          onClick={() => setIndiceVisor(0)}
          className="group relative w-14 h-14 rounded-lg overflow-hidden border border-border shrink-0"
          title="Ver fotos del vehículo"
        >
          <img src={portada} alt={`Foto de ${vehiculo.placa ?? vehiculo.nombre}`} className="w-full h-full object-cover" />
          <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
            <ZoomIn size={16} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
          </span>
          {vehiculo.fotos.length > 1 && (
            <span className="absolute bottom-0 right-0 bg-black/60 text-white text-[10px] px-1 rounded-tl">
              {vehiculo.fotos.length}
            </span>
          )}
        </button>
      ) : (
        <div className="w-14 h-14 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 shrink-0">
          <Car size={20} />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-sm font-semibold text-text-primary truncate">
          {vehiculo.placa ?? vehiculo.nombre}
        </p>
        {vehiculo.placa && <p className="text-xs text-text-secondary truncate">{vehiculo.nombre}</p>}
        {detalle && <p className="text-xs text-text-muted truncate">{detalle}</p>}
      </div>

      {indiceVisor !== null && (
        <VisorFotos
          fotos={vehiculo.fotos}
          indice={indiceVisor}
          onCambiar={setIndiceVisor}
          onCerrar={() => setIndiceVisor(null)}
          alt={`Foto ampliada de ${vehiculo.placa ?? vehiculo.nombre}`}
        />
      )}
    </div>
  );
}

export default VehiculoResumen;
