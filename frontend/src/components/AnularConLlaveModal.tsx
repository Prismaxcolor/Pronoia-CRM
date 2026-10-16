import { useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { EntidadConLlave } from '../services/auditoria-service';
import CampoLlaveEdicion from './CampoLlaveEdicion';

interface Props {
  titulo: string;
  entidadTipo: EntidadConLlave;
  entidadId: string;
  /** Resumen del documento que se va a anular y qué pasará. */
  children?: ReactNode;
  etiquetaBoton: string;
  /** Devuelve el mensaje de error, o null si salió bien. */
  onConfirmar: (motivo: string, llave: string) => Promise<string | null>;
  onClose: () => void;
}

/** Modal de anulación: motivo obligatorio + llave de edición (salvo superadmin). Compartido por pagos, cobros, movimientos y notas. */
function AnularConLlaveModal({ titulo, entidadTipo, entidadId, children, etiquetaBoton, onConfirmar, onClose }: Props) {
  const [motivo, setMotivo] = useState('');
  const [llave, setLlave] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!motivo.trim()) { setError('El motivo de la anulación es obligatorio.'); return; }
    setGuardando(true);
    const fallo = await onConfirmar(motivo.trim(), llave.trim());
    setGuardando(false);
    if (fallo) setError(fallo);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-surface">
          <h2 className="text-lg font-bold text-text-primary">{titulo}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {children}

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Motivo de la anulación *</label>
            <textarea
              required
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              className="w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent resize-none"
              rows={3}
              maxLength={300}
              placeholder="Ej: Registrado por error"
            />
          </div>

          <CampoLlaveEdicion entidadTipo={entidadTipo} entidadId={entidadId} valor={llave} onChange={setLlave} />

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
              {guardando ? 'Anulando...' : etiquetaBoton}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AnularConLlaveModal;
