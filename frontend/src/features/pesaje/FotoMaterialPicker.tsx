import { useRef, useState } from 'react';
import { ImagePlus, Camera, X, ZoomIn } from 'lucide-react';
import { previewFoto, type FotoMaterial } from './material-fila';

interface Props {
  fotos: FotoMaterial[];
  onAgregar: (files: File[]) => void;
  onQuitar: (idx: number) => void;
  /** Reutilizado también para las fotos de la devolución (no atadas a un
   *  material) — el texto del label se ajusta a cada caso. */
  label?: string;
}

/** Selector de fotos de un material — compacto, para vivir dentro de la
 *  tarjeta de cada material en vez de un único bloque general al final del
 *  formulario (Bloque 46). Cada miniatura se puede ampliar en un visor a
 *  pantalla completa (click en la lupa o en la imagen). Dos botones de
 *  carga: uno abre la galería/archivos (multi-selección), otro abre la
 *  cámara directo (una foto por toque, se puede repetir). */
function FotoMaterialPicker({ fotos, onAgregar, onQuitar, label = 'Fotos de este material' }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const camaraRef = useRef<HTMLInputElement>(null);
  const [fotoAmpliada, setFotoAmpliada] = useState<number | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) onAgregar(files);
    e.target.value = '';
  };

  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1">{label}</label>
      <div className="flex flex-wrap gap-2">
        {fotos.map((f, idx) => (
          <div key={idx} className="group relative w-14 h-14 rounded-lg overflow-hidden border border-border">
            <button
              type="button"
              onClick={() => setFotoAmpliada(idx)}
              className="block w-full h-full"
              title="Ver foto en grande"
            >
              <img src={previewFoto(f)} alt={`Foto ${idx + 1}`} className="w-full h-full object-cover" />
              <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
                <ZoomIn size={16} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </span>
            </button>
            <button
              type="button"
              onClick={() => onQuitar(idx)}
              className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5 hover:bg-black/80"
              title="Quitar foto"
            >
              <X size={10} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-14 h-14 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center text-text-muted hover:border-brand-400 hover:text-brand-600 transition-colors"
          title="Elegir de archivos"
        >
          <ImagePlus size={16} />
        </button>
        <button
          type="button"
          onClick={() => camaraRef.current?.click()}
          className="w-14 h-14 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center text-text-muted hover:border-brand-400 hover:text-brand-600 transition-colors"
          title="Tomar foto"
        >
          <Camera size={16} />
        </button>
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple onChange={handleChange} className="hidden" />
      <input ref={camaraRef} type="file" accept="image/*" capture="environment" onChange={handleChange} className="hidden" />

      {fotoAmpliada !== null && fotos[fotoAmpliada] && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4"
          onClick={() => setFotoAmpliada(null)}
        >
          <button
            type="button"
            onClick={() => setFotoAmpliada(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white"
            title="Cerrar"
          >
            <X size={24} />
          </button>
          <img
            src={previewFoto(fotos[fotoAmpliada])}
            alt={`Foto ${fotoAmpliada + 1} ampliada`}
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

export default FotoMaterialPicker;
