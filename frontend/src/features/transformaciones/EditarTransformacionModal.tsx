import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { editarTransformacion } from '../../services/transformacion-service';
import type { Transformacion } from '@shared/types/index.js';

interface Props {
  transformacion: Transformacion;
  /** El servidor exige llave a este usuario (y no es superadmin). */
  requiereLlave: boolean;
  onClose: () => void;
  onGuardada: (t: Transformacion) => void;
}

const inputClass = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
const labelClass = 'block text-xs font-medium text-text-secondary mb-1';

/** Edita fecha y notas. Los pesos y salidas no se editan: afectan el stock. */
function EditarTransformacionModal({ transformacion: t, requiereLlave, onClose, onGuardada }: Props) {
  const [fecha, setFecha] = useState(t.fecha);
  const [notas, setNotas] = useState(t.notas ?? '');
  const [llave, setLlave] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!fecha) { setError('La fecha es obligatoria.'); return; }
    if (requiereLlave && !llave.trim()) { setError('Ingresa la llave de edición.'); return; }
    setGuardando(true);
    const res = await editarTransformacion(t.id, {
      fecha,
      notas: notas.trim(),
      llaveEdicion: requiereLlave ? llave.trim() : undefined,
    });
    setGuardando(false);
    if ('error' in res) { setError(res.error); return; }
    onGuardada(res.transformacion);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 print:hidden">
      <form onSubmit={guardar} className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Editar transformación {t.codigo ?? ''}</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary" title="Cerrar"><X size={18} /></button>
        </div>
        <p className="text-xs text-text-muted">Solo se editan fecha y notas. Los pesos y salidas no se pueden modificar.</p>

        <div>
          <label className={labelClass}>Fecha</label>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className={inputClass} required />
        </div>
        <div>
          <label className={labelClass}>Notas</label>
          <textarea value={notas} onChange={e => setNotas(e.target.value)} maxLength={2000} rows={3} className={`${inputClass} resize-none`} />
        </div>

        {requiereLlave && (
          <div>
            <label className={labelClass}>Llave de edición</label>
            <input
              type="text" value={llave} onChange={e => setLlave(e.target.value)} required autoComplete="off"
              className={`${inputClass} font-mono uppercase tracking-wider`}
              placeholder="Código entregado por el administrador"
            />
            <p className="text-xs text-text-muted mt-1">Pídesela a un administrador.</p>
          </div>
        )}

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm text-text-secondary hover:bg-surface-alt transition-colors">
            Cancelar
          </button>
          <button type="submit" disabled={guardando} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
            {guardando ? <><Loader2 size={16} className="animate-spin" /> Guardando...</> : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default EditarTransformacionModal;
