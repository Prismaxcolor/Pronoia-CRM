import { useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  titulo: string;
  descripcion: string;
  etiquetaConfirmar: string;
  /** Devuelve un texto de error si falló; undefined si salió bien (el padre cierra el modal). */
  onConfirmar: (motivo: string) => Promise<string | undefined>;
  onClose: () => void;
}

/** Pide el motivo de una anulación (obligatorio). */
function MotivoModal({ titulo, descripcion, etiquetaConfirmar, onConfirmar, onClose }: Props) {
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!motivo.trim()) { setError('El motivo de la anulación es obligatorio.'); return; }
    setGuardando(true);
    const fallo = await onConfirmar(motivo.trim());
    setGuardando(false);
    if (fallo) setError(fallo);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md" role="dialog" aria-modal="true" aria-labelledby="motivo-titulo">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 id="motivo-titulo" className="text-lg font-bold text-text-primary">{titulo}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-text-muted hover:text-text-primary transition-colors"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-sm text-text-secondary">{descripcion}</p>
          <div>
            <label htmlFor="motivo-texto" className="block text-xs font-medium text-text-secondary mb-1">Motivo *</label>
            <textarea
              id="motivo-texto" rows={3} maxLength={300} required value={motivo} onChange={e => setMotivo(e.target.value)}
              className="w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          {error && <p role="alert" className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">Cancelar</button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50">
              {guardando ? 'Anulando...' : etiquetaConfirmar}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default MotivoModal;
