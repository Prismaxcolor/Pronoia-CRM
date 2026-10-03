import { useState } from 'react';
import { X } from 'lucide-react';
import { crearVehiculo, actualizarVehiculo } from '../../services/vehiculo-service';
import { subirFotoTicket } from '../../services/storage-service';
import { useToast } from '../../hooks/use-toast-context';
import { fotoLocalDeFile, fotosLocalDeUrls, subirFotosLocal, type FotoLocal } from '../../lib/foto-picker';
import { normalizarPlacaFront } from '../../lib/vehiculo';
import FotoMultiplePicker from '../../components/FotoMultiplePicker';
import type { Vehiculo } from '@shared/types/index.js';

interface Props {
  vehiculo?: Vehiculo | null;
  onClose: () => void;
  onGuardado: () => void;
}

const MAX_FOTOS = 10;

function VehiculoFormModal({ vehiculo, onClose, onGuardado }: Props) {
  const toast = useToast();
  const editando = !!vehiculo;
  // Los vehículos antiguos pueden no tener placa; solo se exige al crear o si ya tenían una.
  const placaObligatoria = !editando || !!vehiculo?.placa;

  const [nombre, setNombre] = useState(vehiculo?.nombre ?? '');
  const [placa, setPlaca] = useState(vehiculo?.placa ?? '');
  const [marca, setMarca] = useState(vehiculo?.marca ?? '');
  const [modelo, setModelo] = useState(vehiculo?.modelo ?? '');
  const [color, setColor] = useState(vehiculo?.color ?? '');
  const [conductor, setConductor] = useState(vehiculo?.conductor ?? '');
  const [descripcion, setDescripcion] = useState(vehiculo?.descripcion ?? '');
  const [fotos, setFotos] = useState<FotoLocal[]>(() => fotosLocalDeUrls(vehiculo?.fotos ?? []));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agregarFotos = (files: File[]) => setFotos(prev => [...prev, ...files.map(fotoLocalDeFile)].slice(0, MAX_FOTOS));
  const quitarFoto = (idx: number) => setFotos(prev => prev.filter((_, i) => i !== idx));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!nombre.trim()) { setError('El nombre es obligatorio.'); return; }
    if (placaObligatoria && !placa.trim()) { setError('La placa es obligatoria.'); return; }

    setGuardando(true);
    const urls = await subirFotosLocal(fotos, subirFotoTicket);
    if (!urls) {
      setError('Error al subir una de las fotos. Intenta de nuevo.');
      setGuardando(false);
      return;
    }

    const datos = {
      nombre: nombre.trim(),
      placa: normalizarPlacaFront(placa),
      marca: marca.trim(),
      modelo: modelo.trim(),
      color: color.trim(),
      conductor: conductor.trim(),
      descripcion: descripcion.trim(),
      fotos: urls,
    };
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
          <FotoMultiplePicker fotos={fotos} onAgregar={agregarFotos} onQuitar={quitarFoto} label="Fotos del vehículo" />

          <div>
            <label className={labelClass}>Placa{placaObligatoria ? '' : ' (opcional)'}</label>
            <input type="text" value={placa} onChange={e => setPlaca(e.target.value.toUpperCase())} maxLength={20} className={inputClass} placeholder="Ej. A12345B" />
          </div>

          <div>
            <label className={labelClass}>Nombre</label>
            <input type="text" value={nombre} onChange={e => setNombre(e.target.value)} maxLength={80} className={inputClass} placeholder="Ej. Margarita" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Marca (opcional)</label>
              <input type="text" value={marca} onChange={e => setMarca(e.target.value)} maxLength={60} className={inputClass} placeholder="Ej. Hino" />
            </div>
            <div>
              <label className={labelClass}>Modelo (opcional)</label>
              <input type="text" value={modelo} onChange={e => setModelo(e.target.value)} maxLength={60} className={inputClass} placeholder="Ej. 500" />
            </div>
            <div>
              <label className={labelClass}>Color (opcional)</label>
              <input type="text" value={color} onChange={e => setColor(e.target.value)} maxLength={60} className={inputClass} placeholder="Ej. Blanco" />
            </div>
            <div>
              <label className={labelClass}>Chofer habitual (opcional)</label>
              <input type="text" value={conductor} onChange={e => setConductor(e.target.value)} maxLength={60} className={inputClass} />
            </div>
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
