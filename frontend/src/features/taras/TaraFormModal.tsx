import { useRef, useState } from 'react';
import { X, ImagePlus } from 'lucide-react';
import { crearTara, actualizarTara } from '../../services/tara-service';
import { subirFotoTara } from '../../services/storage-service';
import { useToast } from '../../hooks/use-toast-context';
import type { Tara } from '@shared/types/index.js';

interface Props {
  tara?: Tara | null;
  onClose: () => void;
  onGuardado: () => void;
}

function TaraFormModal({ tara, onClose, onGuardado }: Props) {
  const toast = useToast();
  const editando = !!tara;

  const [nombre, setNombre] = useState(tara?.nombre ?? '');
  const [peso, setPeso] = useState(tara?.peso ?? 0);
  const [fotoFile, setFotoFile] = useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(tara?.foto ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFotoFile(file);
    setFotoPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!nombre.trim()) { setError('El nombre es obligatorio.'); return; }
    if (peso <= 0) { setError('El peso debe ser mayor a 0.'); return; }

    setGuardando(true);

    let foto: string | null = tara?.foto ?? null;
    if (fotoFile) {
      const subida = await subirFotoTara(fotoFile);
      if (!subida) {
        setError('Error al subir la foto. Intenta de nuevo.');
        setGuardando(false);
        return;
      }
      foto = subida;
    }

    const result = editando && tara
      ? await actualizarTara(tara.id, { nombre, peso, foto })
      : await crearTara({ nombre, peso, foto });

    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    toast.exito(editando ? `Tara "${result.tara.nombre}" actualizada.` : `Tara "${result.tara.nombre}" creada.`);
    onGuardado();
  };

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">{editando ? 'Editar tara' : 'Nueva tara'}</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className={labelClass}>Foto</label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-border rounded-xl p-4 cursor-pointer hover:border-brand-400 transition-colors flex flex-col items-center justify-center min-h-[100px]"
            >
              {fotoPreview ? (
                <img src={fotoPreview} alt="Preview" className="max-h-24 object-contain rounded-lg" />
              ) : (
                <>
                  <ImagePlus size={28} className="text-text-muted mb-2" />
                  <p className="text-xs text-text-muted">Click para seleccionar foto</p>
                </>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFotoChange} className="hidden" />
          </div>

          <div>
            <label className={labelClass}>Nombre</label>
            <input type="text" value={nombre} onChange={e => setNombre(e.target.value)} className={inputClass} placeholder="Ej. Camión 3 ejes" />
          </div>

          <div>
            <label className={labelClass}>Peso (kg)</label>
            <input type="number" step="0.01" min="0" value={peso} onChange={e => setPeso(Number(e.target.value))} className={inputClass} />
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear tara'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default TaraFormModal;
