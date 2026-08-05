import { useRef, useState } from 'react';
import { X, Loader2, ImagePlus } from 'lucide-react';
import { completarTraslado } from '../../services/traslado-service';
import { subirFotoTraslado } from '../../services/storage-service';
import { useToast } from '../../hooks/use-toast-context';
import type { Traslado } from '@shared/types/index.js';

interface Props {
  traslado: Traslado;
  onClose: () => void;
  onCompletado: () => void;
}

interface FotoLocal { file: File; preview: string }

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function CompletarTrasladoModal({ traslado, onClose, onCompletado }: Props) {
  const toast = useToast();
  const [recibido, setRecibido] = useState<Record<string, string>>(
    Object.fromEntries(traslado.materiales.map(m => [m.id, String(m.pesoNeto)]))
  );
  const [fotos, setFotos] = useState<FotoLocal[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setFotos(prev => [...prev, ...files.map(file => ({ file, preview: URL.createObjectURL(file) }))]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  const quitarFoto = (idx: number) => setFotos(prev => prev.filter((_, i) => i !== idx));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (fotos.length === 0) { setError('La recepción requiere al menos una foto de evidencia.'); return; }
    if (traslado.materiales.some(m => !recibido[m.id] || Number(recibido[m.id]) < 0)) {
      setError('Registra lo recibido de cada material (0 o más).');
      return;
    }

    setGuardando(true);

    const urls: string[] = [];
    for (const f of fotos) {
      const url = await subirFotoTraslado(f.file);
      if (!url) {
        setError('No se pudo subir una de las fotos. Intenta de nuevo.');
        setGuardando(false);
        return;
      }
      urls.push(url);
    }

    const result = await completarTraslado(
      traslado.id,
      traslado.materiales.map(m => ({ detalleId: m.id, pesoRecibido: Number(recibido[m.id]) || 0 })),
      urls
    );
    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    toast.exito(`${result.traslado.codigo} recepcionado.`);
    onCompletado();
    onClose();
  };

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">Recepcionar {traslado.codigo}</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-xs text-text-muted">
            De <span className="font-medium text-text-secondary">{traslado.nombreAlmacenOrigen}</span> a{' '}
            <span className="font-medium text-text-secondary">{traslado.nombreAlmacenDestino}</span>. Confirma cuánto
            llegó realmente de cada material — si difiere de lo enviado, queda registrado como discrepancia.
          </p>

          <div className="space-y-2">
            {traslado.materiales.map(m => {
              const recibidoNum = Number(recibido[m.id]) || 0;
              const diferencia = recibidoNum - m.pesoNeto;
              return (
                <div key={m.id} className="border border-border rounded-lg p-3 bg-surface-alt/40">
                  <p className="text-sm font-medium text-text-primary mb-2">{m.nombreProducto ?? 'Material'}</p>
                  <div className="grid grid-cols-2 gap-3 items-end">
                    <div>
                      <p className="text-xs text-text-muted mb-1">Enviado</p>
                      <p className="text-sm font-semibold text-text-secondary">{fmt(m.pesoNeto)} kg</p>
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">Recibido (kg)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={recibido[m.id] ?? ''}
                        onChange={e => setRecibido(prev => ({ ...prev, [m.id]: e.target.value }))}
                        className={inputClass}
                      />
                    </div>
                  </div>
                  {Math.abs(diferencia) > 0.01 && (
                    <p className={`text-xs mt-2 font-medium ${diferencia < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                      Discrepancia: {diferencia > 0 ? '+' : ''}{fmt(diferencia)} kg
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Fotos de evidencia *</label>
            <div className="flex flex-wrap gap-2">
              {fotos.map((f, idx) => (
                <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden border border-border">
                  <img src={f.preview} alt={`Foto ${idx + 1}`} className="w-full h-full object-cover" />
                  <button type="button" onClick={() => quitarFoto(idx)} className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5 hover:bg-black/80">
                    <X size={12} />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => fileInputRef.current?.click()} className="w-20 h-20 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center text-text-muted hover:border-brand-400 hover:text-brand-600 transition-colors">
                <ImagePlus size={20} />
                <span className="text-[10px] mt-1">Agregar</span>
              </button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFotos} className="hidden" />
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? <><Loader2 size={16} className="animate-spin" /> Guardando...</> : 'Confirmar recepción'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CompletarTrasladoModal;
