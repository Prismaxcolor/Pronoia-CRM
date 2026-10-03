import { useState } from 'react';
import { X } from 'lucide-react';
import { crearVehiculo, actualizarVehiculo } from '../../services/vehiculo-service';
import { useToast } from '../../hooks/use-toast-context';
import type { Vehiculo } from '@shared/types/index.js';

interface Props {
  vehiculo?: Vehiculo | null;
  onClose: () => void;
  onGuardado: () => void;
}

function VehiculoFormModal({ vehiculo, onClose, onGuardado }: Props) {
  const toast = useToast();
  const editando = !!vehiculo;

  const [nombre, setNombre] = useState(vehiculo?.nombre ?? '');
  const [descripcion, setDescripcion] = useState(vehiculo?.descripcion ?? '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!nombre.trim()) { setError('La placa o nombre es obligatorio.'); return; }

    setGuardando(true);
    const datos = { nombre: nombre.trim(), descripcion: descripcion.trim() };
    const result = editando && vehiculo
      ? await actualizarVehiculo(vehiculo.id, datos)
      : await crearVehiculo(datos);
    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    toast.exito(editando ? `Vehículo "${result.vehiculo.nombre}" actualizado.` : `Vehículo "${result.vehiculo.nombre}" creado.`);
    onGuardado();
  };

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">{editando ? 'Editar vehículo' : 'Nuevo vehículo'}</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className={labelClass}>Placa / nombre</label>
            <input type="text" value={nombre} onChange={e => setNombre(e.target.value)} maxLength={80} className={inputClass} placeholder="Ej. A12345B" />
          </div>

          <div>
            <label className={labelClass}>Descripción / tipo (opcional)</label>
            <input type="text" value={descripcion} onChange={e => setDescripcion(e.target.value)} maxLength={200} className={inputClass} placeholder="Ej. Camión 350, rastra" />
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear vehículo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default VehiculoFormModal;
