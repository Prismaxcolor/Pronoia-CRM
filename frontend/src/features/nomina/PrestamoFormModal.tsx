import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { crearPrestamo, obtenerTrabajadores } from '../../services/nomina-service';
import { useToast } from '../../hooks/use-toast-context';
import { hoyNegocio } from '../../lib/fecha-negocio';
import {
  ETIQUETA_TIPO_PRESTAMO, ETIQUETA_TIPO_TRABAJADOR, TIPOS_PRESTAMO, formatearNumeroPrestamo, nombreCompleto, type TipoPrestamo, type Trabajador,
} from '@shared/types/nomina';
import { leerNumero } from './nomina-editor';

interface Props {
  onClose: () => void;
  onCreado: () => void;
}

const inputClass = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
const labelClass = 'block text-xs font-medium text-text-secondary mb-1';

function PrestamoFormModal({ onClose, onCreado }: Props) {
  const toast = useToast();
  const [trabajadores, setTrabajadores] = useState<Trabajador[]>([]);
  const [trabajadorId, setTrabajadorId] = useState('');
  // Sin valor por defecto: hay que elegir si es préstamo o adelanto a propósito.
  const [tipo, setTipo] = useState<TipoPrestamo | ''>('');
  const [monto, setMonto] = useState('');
  const [cuota, setCuota] = useState('');
  const [fecha, setFecha] = useState(hoyNegocio());
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void obtenerTrabajadores().then(r => {
      if (!vivo) return;
      if ('error' in r) setError(r.error);
      else setTrabajadores(r.trabajadores);
    });
    return () => { vivo = false; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const montoUsd = leerNumero(monto);
    const cuotaSemanalUsd = leerNumero(cuota);
    if (!trabajadorId) { setError('Elige al trabajador.'); return; }
    if (!tipo) { setError('Elige si es un préstamo o un adelanto.'); return; }
    if (montoUsd === null || montoUsd <= 0) { setError('El monto debe ser mayor a 0.'); return; }
    if (cuota.trim() && (cuotaSemanalUsd === null || cuotaSemanalUsd <= 0 || cuotaSemanalUsd > montoUsd)) {
      setError('La cuota semanal debe ser mayor a 0 y no puede superar el monto.');
      return;
    }
    setGuardando(true);
    const r = await crearPrestamo({ trabajadorId, tipo, montoUsd, cuotaSemanalUsd, fecha, nota: nota.trim() || null });
    setGuardando(false);
    if ('error' in r) { setError(r.error); return; }
    toast.exito(`${ETIQUETA_TIPO_PRESTAMO[r.prestamo.tipo]} ${formatearNumeroPrestamo(r.prestamo.numero)} registrado.`);
    onCreado();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="prestamo-titulo">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 id="prestamo-titulo" className="text-lg font-bold text-text-primary">Nuevo préstamo o adelanto</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-text-muted hover:text-text-primary transition-colors"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label htmlFor="pre-trabajador" className={labelClass}>Trabajador *</label>
            <select id="pre-trabajador" value={trabajadorId} onChange={e => setTrabajadorId(e.target.value)} className={inputClass}>
              <option value="">Elige…</option>
              {trabajadores.map(t => <option key={t.id} value={t.id}>{nombreCompleto(t)} · {ETIQUETA_TIPO_TRABAJADOR[t.tipo]}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pre-tipo" className={labelClass}>Tipo *</label>
              <select id="pre-tipo" value={tipo} onChange={e => setTipo(e.target.value as TipoPrestamo | '')} className={inputClass}>
                <option value="">Elige…</option>
                {TIPOS_PRESTAMO.map(t => <option key={t} value={t}>{ETIQUETA_TIPO_PRESTAMO[t]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="pre-fecha" className={labelClass}>Fecha *</label>
              <input id="pre-fecha" type="date" required value={fecha} onChange={e => setFecha(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="pre-monto" className={labelClass}>Monto (USD) *</label>
              <input id="pre-monto" inputMode="decimal" value={monto} onChange={e => setMonto(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="pre-cuota" className={labelClass}>Cuota por semana (USD)</label>
              <input id="pre-cuota" inputMode="decimal" value={cuota} onChange={e => setCuota(e.target.value)} className={inputClass} aria-describedby="pre-cuota-ayuda" />
            </div>
          </div>
          <p id="pre-cuota-ayuda" className="text-xs text-text-muted">
            Con cuota semanal, cada nómina propone descontarla sola (tú puedes cambiarla). Sin cuota, la descuentas a mano cuando quieras.
          </p>
          <div>
            <label htmlFor="pre-nota" className={labelClass}>Nota</label>
            <textarea id="pre-nota" rows={2} maxLength={300} value={nota} onChange={e => setNota(e.target.value)} className={inputClass} />
          </div>
          {error && <p role="alert" className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">Cancelar</button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Guardando...' : 'Registrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default PrestamoFormModal;
