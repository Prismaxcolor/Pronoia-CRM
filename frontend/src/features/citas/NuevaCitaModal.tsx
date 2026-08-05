import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { obtenerProveedores } from '../../services/proveedor-service';
import { obtenerClientes } from '../../services/cliente-service';
import { obtenerHorarios, crearCitaStaff } from '../../services/citas-service';
import { useToast } from '../../hooks/use-toast';

interface Entidad { id: string; nombre: string; activo: boolean }
type TipoEntidad = 'proveedor' | 'cliente';

interface Props {
  onClose: () => void;
  onAgendada: () => void;
}

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function NuevaCitaModal({ onClose, onAgendada }: Props) {
  const toast = useToast();

  const [tipo, setTipo] = useState<TipoEntidad>('proveedor');
  const [entidades, setEntidades] = useState<Entidad[]>([]);
  const [entidadId, setEntidadId] = useState('');
  const [horarios, setHorarios] = useState<string[]>([]);
  const [fecha, setFecha] = useState(hoyISO());
  const [hora, setHora] = useState('');
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cargar = (): Promise<Entidad[]> => (tipo === 'proveedor' ? obtenerProveedores() : obtenerClientes());
    cargar().then(lista => setEntidades(lista.filter(e => e.activo)));
    setEntidadId('');
  }, [tipo]);

  useEffect(() => { obtenerHorarios().then(setHorarios); }, []);

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!entidadId) { setError(`Elige un ${tipo === 'proveedor' ? 'proveedor' : 'cliente'}.`); return; }
    if (!hora) { setError('Elige un horario.'); return; }

    setGuardando(true);
    const result = await crearCitaStaff({ entidadTipo: tipo, entidadId, fecha, hora, notas: notas.trim() || undefined });
    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    toast.exito('Cita agendada.');
    onAgendada();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">Agendar despacho</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className={labelClass}>Tipo</label>
            <div className="flex rounded-lg overflow-hidden border border-border text-sm w-fit">
              <button type="button" onClick={() => setTipo('proveedor')} className={`px-4 py-1.5 ${tipo === 'proveedor' ? 'bg-brand-600 text-white' : 'bg-surface-alt text-text-secondary'}`}>
                Proveedor
              </button>
              <button type="button" onClick={() => setTipo('cliente')} className={`px-4 py-1.5 ${tipo === 'cliente' ? 'bg-brand-600 text-white' : 'bg-surface-alt text-text-secondary'}`}>
                Cliente
              </button>
            </div>
          </div>

          <div>
            <label className={labelClass}>{tipo === 'proveedor' ? 'Proveedor' : 'Cliente'} *</label>
            <select value={entidadId} onChange={e => setEntidadId(e.target.value)} className={inputClass}>
              <option value="">— Selecciona —</option>
              {entidades.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Fecha *</label>
              <input type="date" value={fecha} min={hoyISO()} onChange={e => setFecha(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Hora *</label>
              <select value={hora} onChange={e => setHora(e.target.value)} className={inputClass}>
                <option value="">— Selecciona —</option>
                {horarios.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>Notas</label>
            <textarea value={notas} onChange={e => setNotas(e.target.value)} className={`${inputClass} resize-none`} rows={2} placeholder="Opcional" />
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? <><Loader2 size={16} className="animate-spin" /> Guardando...</> : 'Agendar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default NuevaCitaModal;
