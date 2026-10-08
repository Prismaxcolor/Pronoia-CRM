import { useState } from 'react';
import { X } from 'lucide-react';
import { registrarAsiento } from '../../services/mesa-cambio-service';
import { useToast } from '../../hooks/use-toast-context';
import { hoyNegocio } from '../../lib/fecha-negocio';
import { ETIQUETA_TIPO_ASIENTO, TIPOS_ASIENTO, formatearNumeroAsiento, type TipoAsiento } from '@shared/types/mesa-cambio';

interface Props {
  cambistaId: string;
  cambistaNombre: string;
  onClose: () => void;
  onRegistrado: () => void;
}

const inputClass = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
const labelClass = 'block text-xs font-medium text-text-secondary mb-1';

/** Número desde un texto con coma o punto decimal; null si está vacío o no es un número. */
function leerNumero(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.');
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

function AsientoModal({ cambistaId, cambistaNombre, onClose, onRegistrado }: Props) {
  const toast = useToast();
  // Sin valor por defecto: el tipo hay que elegirlo a propósito.
  const [tipo, setTipo] = useState<TipoAsiento | ''>('');
  const [monto, setMonto] = useState('');
  const [tasa, setTasa] = useState('');
  const [fecha, setFecha] = useState(hoyNegocio());
  const [nota, setNota] = useState('');
  const [referencia, setReferencia] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const montoUsd = leerNumero(monto);
    const tasaNum = leerNumero(tasa);
    if (!tipo) { setError('Elige el tipo de asiento (cargo o cobro).'); return; }
    if (montoUsd === null || montoUsd <= 0) { setError('El monto debe ser mayor a 0.'); return; }
    if (tasa.trim() && (tasaNum === null || tasaNum <= 0)) { setError('La tasa debe ser un número mayor a 0.'); return; }
    setGuardando(true);
    const r = await registrarAsiento({
      cambistaId, tipo, montoUsd, tasa: tasaNum, fecha, nota: nota.trim() || null, referencia: referencia.trim() || null,
    });
    setGuardando(false);
    if ('error' in r) { setError(r.error); return; }
    toast.exito(`Asiento ${formatearNumeroAsiento(r.asiento.numero)} registrado.`);
    onRegistrado();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">Registrar asiento · {cambistaNombre}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-xs text-text-secondary">
            Es solo una anotación de deuda en USD: no mueve el saldo de Wallet ni de ninguna banca.
          </p>
          <div>
            <label htmlFor="asiento-tipo" className={labelClass}>Tipo de asiento *</label>
            <select id="asiento-tipo" required value={tipo} onChange={e => setTipo(e.target.value as TipoAsiento | '')} className={inputClass}>
              <option value="">— Selecciona —</option>
              {TIPOS_ASIENTO.map(t => <option key={t} value={t}>{ETIQUETA_TIPO_ASIENTO[t]}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="asiento-monto" className={labelClass}>Monto (USD) *</label>
              <input id="asiento-monto" type="text" inputMode="decimal" required value={monto} onChange={e => setMonto(e.target.value)} className={inputClass} placeholder="0,00" />
            </div>
            <div>
              <label htmlFor="asiento-fecha" className={labelClass}>Fecha *</label>
              <input id="asiento-fecha" type="date" required value={fecha} onChange={e => setFecha(e.target.value)} className={inputClass} />
            </div>
          </div>
          <div>
            <label htmlFor="asiento-tasa" className={labelClass}>Tasa (opcional, solo informativa)</label>
            <input id="asiento-tasa" type="text" inputMode="decimal" value={tasa} onChange={e => setTasa(e.target.value)} className={inputClass} placeholder="Ej. 36,50" />
          </div>
          <div>
            <label htmlFor="asiento-referencia" className={labelClass}>Referencia (opcional)</label>
            <input id="asiento-referencia" type="text" maxLength={60} value={referencia} onChange={e => setReferencia(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="asiento-nota" className={labelClass}>Nota (opcional)</label>
            <textarea id="asiento-nota" rows={2} maxLength={300} value={nota} onChange={e => setNota(e.target.value)} className={inputClass} />
          </div>
          {error && <p role="alert" className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Guardando...' : 'Registrar asiento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AsientoModal;
