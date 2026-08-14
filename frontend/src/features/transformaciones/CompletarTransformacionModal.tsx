import { useState } from 'react';
import { X, Plus, Trash2, Loader2 } from 'lucide-react';
import { completarTransformacion } from '../../services/transformacion-service';
import { useToast } from '../../hooks/use-toast-context';
import type { Transformacion, Lote } from '@shared/types/index.js';

interface SalidaForm { uid: number; loteDestinoId: string; pesoBruto: string; tara: string }

let UID = 0;
function salidaVacia(): SalidaForm {
  return { uid: UID++, loteDestinoId: '', pesoBruto: '', tara: '' };
}

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Props {
  transformacion: Transformacion;
  lotes: Lote[];
  onClose: () => void;
  onCompletada: () => void;
}

function CompletarTransformacionModal({ transformacion, lotes, onClose, onCompletada }: Props) {
  const toast = useToast();
  const [salidas, setSalidas] = useState<SalidaForm[]>([salidaVacia()]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lotesDestino = lotes.filter(l => l.id !== transformacion.loteOrigenId);

  const setSalida = (uid: number, campo: 'loteDestinoId' | 'pesoBruto' | 'tara', valor: string) =>
    setSalidas(prev => prev.map(s => (s.uid === uid ? { ...s, [campo]: valor } : s)));
  const agregarSalida = () => setSalidas(prev => [...prev, salidaVacia()]);
  const quitarSalida = (uid: number) =>
    setSalidas(prev => (prev.length > 1 ? prev.filter(s => s.uid !== uid) : prev));

  const neto = (s: SalidaForm) => (Number(s.pesoBruto) || 0) - (Number(s.tara) || 0);
  const sumaNetos = salidas.reduce((acc, s) => acc + neto(s), 0);
  const restante = transformacion.pesoNeto - sumaNetos;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (salidas.some(s => !s.loteDestinoId)) { setError('Selecciona el lote destino en cada fila.'); return; }
    if (salidas.some(s => neto(s) <= 0)) { setError('Cada salida debe tener un peso neto mayor a 0.'); return; }
    const idsDestino = salidas.map(s => s.loteDestinoId);
    if (new Set(idsDestino).size !== idsDestino.length) { setError('No repitas el mismo lote destino en dos filas.'); return; }
    if (sumaNetos > transformacion.pesoNeto + 0.01) {
      setError(`La suma de las salidas (${fmt(sumaNetos)} kg) supera lo que entró (${fmt(transformacion.pesoNeto)} kg).`);
      return;
    }

    setGuardando(true);
    const result = await completarTransformacion(
      transformacion.id,
      salidas.map(s => ({ loteDestinoId: s.loteDestinoId, pesoBruto: Number(s.pesoBruto) || 0, tara: Number(s.tara) || 0 }))
    );
    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    toast.exito('Transformación completada.');
    onCompletada();
  };

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-surface">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Completar transformación</h2>
            <p className="text-sm text-text-secondary">
              Entró <span className="font-semibold">{fmt(transformacion.pesoNeto)} kg</span> de {transformacion.nombreLoteOrigen}. Pesa a dónde salió.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors shrink-0">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-3">
            {salidas.map(s => (
              <div key={s.uid} className="border border-border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <select
                    required
                    value={s.loteDestinoId}
                    onChange={e => setSalida(s.uid, 'loteDestinoId', e.target.value)}
                    className={`${inputClass} flex-1`}
                  >
                    <option value="" disabled>-Selecciona el lote destino-</option>
                    {lotesDestino.map(l => (
                      <option key={l.id} value={l.id}>{l.nombre}</option>
                    ))}
                  </select>
                  {salidas.length > 1 && (
                    <button type="button" onClick={() => quitarSalida(s.uid)} className="p-2 text-text-muted hover:text-red-600 transition-colors shrink-0" title="Quitar salida">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelClass}>Peso bruto (kg)</label>
                    <input type="number" step="0.01" min="0.01" value={s.pesoBruto} onChange={e => setSalida(s.uid, 'pesoBruto', e.target.value)} className={inputClass} placeholder="0.00" />
                  </div>
                  <div>
                    <label className={labelClass}>Tara (kg)</label>
                    <input type="number" step="0.01" min="0" value={s.tara} onChange={e => setSalida(s.uid, 'tara', e.target.value)} className={inputClass} placeholder="0.00" />
                  </div>
                </div>
                <p className="text-xs text-text-muted text-right">Neto: {fmt(neto(s))} kg</p>
              </div>
            ))}
          </div>

          <button type="button" onClick={agregarSalida} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
            <Plus size={13} /> Agregar salida
          </button>

          <div className="bg-surface-alt rounded-lg px-4 py-2.5 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-text-secondary">Suma de salidas</span>
              <span className="font-medium">{fmt(sumaNetos)} kg</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">{restante >= -0.01 ? 'Merma' : 'Excede lo que entró'}</span>
              <span className={`font-semibold ${restante < -0.01 ? 'text-red-600' : 'text-text-primary'}`}>{fmt(restante)} kg</span>
            </div>
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
            <button type="submit" disabled={guardando} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? <><Loader2 size={16} className="animate-spin" /> Guardando...</> : 'Completar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CompletarTransformacionModal;
