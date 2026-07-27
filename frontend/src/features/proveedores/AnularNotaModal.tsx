import { useState } from 'react';
import { X } from 'lucide-react';
import { anularNotaAjuste } from '../../services/nota-ajuste-service';
import type { EntradaEstadoCuenta } from '../../services/estado-cuenta-service';

interface Props {
  proveedorId: string;
  nota: EntradaEstadoCuenta;
  onClose: () => void;
  onAnulada: () => void;
}

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function AnularNotaModal({ proveedorId, nota, onClose, onAnulada }: Props) {
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const monto = nota.tipo === 'nota_debito' ? nota.cargo : nota.abono;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!motivo.trim()) { setError('El motivo de la anulación es obligatorio.'); return; }
    if (!nota.notaId) { setError('Nota inválida.'); return; }

    setGuardando(true);
    const result = await anularNotaAjuste(proveedorId, nota.notaId, motivo.trim());
    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    onAnulada();
  };

  const inputClass = "w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-surface">
          <h2 className="text-lg font-bold text-text-primary">Anular nota</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="bg-surface-alt border border-border rounded-lg p-3 text-sm">
            <p className="text-text-secondary">{nota.tipo === 'nota_debito' ? 'Nota de débito' : 'Nota de crédito'} · ${fmt(monto)}</p>
            <p className="text-text-primary mt-1">{nota.descripcion}</p>
          </div>

          <p className="text-xs text-text-muted">
            No se borra: se crea una nota contraria por el mismo monto que cancela su efecto en el saldo, y esta queda marcada como anulada.
          </p>

          <div>
            <label className={labelClass}>Motivo de la anulación *</label>
            <textarea
              required
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              className={`${inputClass} resize-none`}
              rows={3}
              maxLength={300}
              placeholder="Ej: Monto cargado por error"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50">
              {guardando ? 'Anulando...' : 'Anular nota'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AnularNotaModal;
