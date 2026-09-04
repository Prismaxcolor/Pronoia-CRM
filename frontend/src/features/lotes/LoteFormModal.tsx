import { useState } from 'react';
import { X } from 'lucide-react';
import { actualizarLote } from '../../services/lote-service';
import { subirFotoLote } from '../../services/storage-service';
import { fotoLocalDeFile, fotosLocalDeUrls, subirFotosLocal, type FotoLocal } from '../../lib/foto-picker';
import FotoMultiplePicker from '../../components/FotoMultiplePicker';
import { useToast } from '../../hooks/use-toast-context';
import type { Lote } from '@shared/types/index.js';

interface Props {
  lote: Lote;
  onClose: () => void;
  onGuardado: () => void;
}

/** Editar un lote existente — nombre y fotos. El almacén y el estado
 *  activo/inactivo se editan inline desde LotesPanel, no acá, para no tener
 *  dos lugares distintos editando el mismo campo. */
function LoteFormModal({ lote, onClose, onGuardado }: Props) {
  const toast = useToast();

  const [nombre, setNombre] = useState(lote.nombre);
  const [fotos, setFotos] = useState<FotoLocal[]>(() => fotosLocalDeUrls(lote.fotos));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agregarFotos = (files: File[]) => setFotos(prev => [...prev, ...files.map(fotoLocalDeFile)]);
  const quitarFoto = (idx: number) => setFotos(prev => prev.filter((_, i) => i !== idx));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const limpio = nombre.trim();
    if (!limpio) { setError('El nombre es obligatorio.'); return; }

    setGuardando(true);

    const urls = await subirFotosLocal(fotos, subirFotoLote);
    if (!urls) { setError('Error al subir una de las fotos.'); setGuardando(false); return; }

    const result = await actualizarLote(lote.id, { nombre: limpio, fotos: urls });
    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    toast.exito(`Lote "${result.lote.nombre}" actualizado.`);
    onGuardado();
  };

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">Editar lote</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className={labelClass}>Nombre</label>
            <input type="text" value={nombre} onChange={e => setNombre(e.target.value)} className={inputClass} placeholder="Ej. Lote 1" />
          </div>

          <FotoMultiplePicker fotos={fotos} onAgregar={agregarFotos} onQuitar={quitarFoto} label="Fotos del lote" />

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default LoteFormModal;
