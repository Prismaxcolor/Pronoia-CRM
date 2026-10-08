import { useState } from 'react';
import { X } from 'lucide-react';
import { actualizarCambista, crearCambista } from '../../services/mesa-cambio-service';
import { useToast } from '../../hooks/use-toast-context';
import type { Cambista } from '@shared/types/mesa-cambio';

interface Props {
  /** Si se pasa, modo "editar". Si no, modo "crear". */
  cambista?: Cambista | null;
  onClose: () => void;
  onGuardado: () => void;
}

const inputClass = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
const labelClass = 'block text-xs font-medium text-text-secondary mb-1';

function CambistaFormModal({ cambista, onClose, onGuardado }: Props) {
  const toast = useToast();
  const editando = !!cambista;
  const [nombre, setNombre] = useState(cambista?.nombre ?? '');
  const [telefono, setTelefono] = useState(cambista?.telefono ?? '');
  const [email, setEmail] = useState(cambista?.email ?? '');
  const [notas, setNotas] = useState(cambista?.notas ?? '');
  const [activo, setActivo] = useState(cambista?.activo ?? true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    const datos = { nombre: nombre.trim(), telefono: telefono.trim() || null, email: email.trim() || null, notas: notas.trim() || null };
    const r = cambista ? await actualizarCambista(cambista.id, { ...datos, activo }) : await crearCambista(datos);
    setGuardando(false);
    if ('error' in r) { setError(r.error); return; }
    toast.exito(editando ? `"${r.cambista.nombre}" actualizado.` : `"${r.cambista.nombre}" creado.`);
    onGuardado();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">{editando ? 'Editar cambista' : 'Nuevo cambista'}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label htmlFor="cambista-nombre" className={labelClass}>Nombre *</label>
            <input id="cambista-nombre" type="text" required maxLength={120} value={nombre} onChange={e => setNombre(e.target.value)} className={inputClass} placeholder="Ej. Casa de cambio Los Andes" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="cambista-telefono" className={labelClass}>Teléfono</label>
              <input id="cambista-telefono" type="text" maxLength={40} value={telefono} onChange={e => setTelefono(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="cambista-email" className={labelClass}>Email</label>
              <input id="cambista-email" type="email" maxLength={120} value={email} onChange={e => setEmail(e.target.value)} className={inputClass} />
            </div>
          </div>
          <div>
            <label htmlFor="cambista-notas" className={labelClass}>Notas</label>
            <textarea id="cambista-notas" rows={2} maxLength={500} value={notas} onChange={e => setNotas(e.target.value)} className={inputClass} />
          </div>
          {editando && (
            <label className="flex items-center gap-2 text-sm text-text-primary">
              <input type="checkbox" checked={activo} onChange={e => setActivo(e.target.checked)} />
              Activo (los inactivos no admiten asientos nuevos)
            </label>
          )}
          {error && <p role="alert" className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear cambista'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CambistaFormModal;
