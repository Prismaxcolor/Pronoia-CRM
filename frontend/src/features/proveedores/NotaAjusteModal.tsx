import { useState } from 'react';
import { X } from 'lucide-react';
import { crearNotaAjuste } from '../../services/nota-ajuste-service';

interface Props {
  proveedorId: string;
  onClose: () => void;
  onCreada: (codigo?: string | null) => void;
}

type Tipo = 'credito' | 'debito';

function NotaAjusteModal({ proveedorId, onClose, onCreada }: Props) {
  const [tipo, setTipo] = useState<Tipo>('credito');
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputClass = "w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const montoNum = Number(monto);
    if (!montoNum || montoNum <= 0) { setError('El monto debe ser mayor a 0.'); return; }
    if (!motivo.trim()) { setError('El motivo es obligatorio.'); return; }

    setGuardando(true);
    const result = await crearNotaAjuste(proveedorId, { tipo, monto: montoNum, motivo: motivo.trim() });
    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    onCreada(result.codigo);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-surface">
          <h2 className="text-lg font-bold text-text-primary">Nota de crédito / débito</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className={labelClass}>Tipo de nota *</label>
            <div className="flex rounded-lg overflow-hidden border border-border text-sm">
              <button type="button" onClick={() => setTipo('credito')} className={`flex-1 px-4 py-2 ${tipo === 'credito' ? 'bg-brand-600 text-white' : 'bg-surface-alt text-text-secondary'}`}>
                Crédito (descuento)
              </button>
              <button type="button" onClick={() => setTipo('debito')} className={`flex-1 px-4 py-2 ${tipo === 'debito' ? 'bg-brand-600 text-white' : 'bg-surface-alt text-text-secondary'}`}>
                Débito (aumento)
              </button>
            </div>
            <p className="text-xs text-text-muted mt-1">
              {tipo === 'credito'
                ? 'Resta del saldo que le debemos al proveedor (ej. descuento de flete).'
                : 'Suma al saldo que le debemos al proveedor (ej. comisión o servicio adicional).'}
            </p>
          </div>

          <div>
            <label className={labelClass}>Monto (USD) *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">$</span>
              <input
                type="number" step="0.01" min="0.01" required
                value={monto}
                onChange={e => setMonto(e.target.value)}
                className={`${inputClass} pl-7`}
                placeholder="0.00"
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Motivo *</label>
            <textarea
              required
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              className={`${inputClass} resize-none`}
              rows={3}
              maxLength={300}
              placeholder="Ej: Descuento por flete no realizado por el proveedor"
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
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Guardando...' : 'Crear nota'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default NotaAjusteModal;
