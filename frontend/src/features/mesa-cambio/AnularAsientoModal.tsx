import { useState } from 'react';
import { X } from 'lucide-react';
import { anularAsientoMesa } from '../../services/mesa-cambio-service';
import { formatearNumeroAsiento } from '@shared/types/mesa-cambio';

interface Props {
  asientoId: string;
  numero: number;
  onClose: () => void;
  onAnulado: () => void;
}

function AnularAsientoModal({ asientoId, numero, onClose, onAnulado }: Props) {
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!motivo.trim()) { setError('El motivo de la anulación es obligatorio.'); return; }
    setGuardando(true);
    const r = await anularAsientoMesa(asientoId, motivo.trim());
    setGuardando(false);
    if ('error' in r) { setError(r.error); return; }
    onAnulado();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">Anular asiento {formatearNumeroAsiento(numero)}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-sm text-text-secondary">
            El asiento se conserva en el historial, tachado, y deja de contar en el saldo. No se puede reactivar.
          </p>
          <div>
            <label htmlFor="anular-motivo" className="block text-xs font-medium text-text-secondary mb-1">Motivo *</label>
            <textarea
              id="anular-motivo" rows={3} maxLength={300} required value={motivo} onChange={e => setMotivo(e.target.value)}
              className="w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          {error && <p role="alert" className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50">
              {guardando ? 'Anulando...' : 'Anular asiento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AnularAsientoModal;
