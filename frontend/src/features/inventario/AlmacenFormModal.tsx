import { useState } from 'react';
import { X } from 'lucide-react';
import { crearAlmacen, actualizarAlmacen } from '../../services/almacen-service';
import { subirFotoAlmacen } from '../../services/storage-service';
import { fotoLocalDeFile, fotosLocalDeUrls, subirFotosLocal, type FotoLocal } from '../../lib/foto-picker';
import FotoMultiplePicker from '../../components/FotoMultiplePicker';
import { useToast } from '../../hooks/use-toast-context';
import type { Almacen } from '@shared/types/index.js';

interface Props {
  almacen?: Almacen | null;
  onClose: () => void;
  onGuardado: () => void;
}

function AlmacenFormModal({ almacen, onClose, onGuardado }: Props) {
  const toast = useToast();
  const editando = !!almacen;

  const [nombre, setNombre] = useState(almacen?.nombre ?? '');
  const [detalle, setDetalle] = useState(almacen?.detalle ?? '');
  const [fotos, setFotos] = useState<FotoLocal[]>(() => fotosLocalDeUrls(almacen?.fotos ?? []));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agregarFotos = (files: File[]) => setFotos(prev => [...prev, ...files.map(fotoLocalDeFile)]);
  const quitarFoto = (idx: number) => setFotos(prev => prev.filter((_, i) => i !== idx));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!nombre.trim()) { setError('El nombre es obligatorio.'); return; }

    setGuardando(true);

    const urls = await subirFotosLocal(fotos, subirFotoAlmacen);
    if (!urls) { setError('Error al subir una de las fotos.'); setGuardando(false); return; }

    const result = editando && almacen
      ? await actualizarAlmacen(almacen.id, { nombre, detalle: detalle.trim() || null, fotos: urls })
      : await crearAlmacen({ nombre, detalle: detalle.trim() || null, fotos: urls });

    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    toast.exito(editando ? `Almacén "${result.almacen.nombre}" actualizado.` : `Almacén "${result.almacen.nombre}" creado.`);
    onGuardado();
  };

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">{editando ? 'Editar almacén' : 'Nuevo almacén'}</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className={labelClass}>Nombre</label>
            <input type="text" value={nombre} onChange={e => setNombre(e.target.value)} className={inputClass} placeholder="Ej. Almacén G1" />
          </div>

          <div>
            <label className={labelClass}>Dirección / detalle</label>
            <textarea value={detalle} onChange={e => setDetalle(e.target.value)} className={`${inputClass} resize-none`} rows={3} placeholder="Ej. Zona industrial, galpón 4" />
          </div>

          <FotoMultiplePicker fotos={fotos} onAgregar={agregarFotos} onQuitar={quitarFoto} label="Fotos" />

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear almacén'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AlmacenFormModal;
