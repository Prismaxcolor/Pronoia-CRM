import { useRef } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { previewFoto, type FotoMaterial } from './material-fila';

interface Props {
  fotos: FotoMaterial[];
  onAgregar: (files: File[]) => void;
  onQuitar: (idx: number) => void;
}

/** Selector de fotos de un material — compacto, para vivir dentro de la
 *  tarjeta de cada material en vez de un único bloque general al final del
 *  formulario (Bloque 46). */
function FotoMaterialPicker({ fotos, onAgregar, onQuitar }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) onAgregar(files);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1">Fotos de este material</label>
      <div className="flex flex-wrap gap-2">
        {fotos.map((f, idx) => (
          <div key={idx} className="relative w-14 h-14 rounded-lg overflow-hidden border border-border">
            <img src={previewFoto(f)} alt={`Foto ${idx + 1}`} className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => onQuitar(idx)}
              className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5 hover:bg-black/80"
            >
              <X size={10} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-14 h-14 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center text-text-muted hover:border-brand-400 hover:text-brand-600 transition-colors"
        >
          <ImagePlus size={16} />
        </button>
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple onChange={handleChange} className="hidden" />
    </div>
  );
}

export default FotoMaterialPicker;
