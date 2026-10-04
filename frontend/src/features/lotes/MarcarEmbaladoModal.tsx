import { useCallback, useEffect, useState } from 'react';
import { X, Loader2, Undo2 } from 'lucide-react';
import { anularEmbalaje, marcarEmbalado, obtenerEmbalajes, type EmbalajeLote } from '../../services/lote-service';
import { useToast } from '../../hooks/use-toast-context';
import type { Lote } from '@shared/types/index.js';

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

const inputClass = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
const labelClass = 'block text-xs font-medium text-text-secondary mb-1';

interface Props {
  lote: Lote;
  /** Puede marcar y anular (productos:editar). */
  puedeEditar: boolean;
  onClose: () => void;
  /** Se marcó o anuló algo: el panel recarga los lotes. */
  onCambio: () => void;
}

/** Marca N kg de un lote como embalados/listos (un mismo lote puede tener parte embalada y parte en saca)
 *  y permite anular un embalaje vigente. El servidor valida contra el stock; aquí solo se orienta. */
function MarcarEmbaladoModal({ lote, puedeEditar, onClose, onCambio }: Props) {
  const toast = useToast();
  const enSaca = lote.embalado?.enSacaKg ?? Math.max(lote.stockKg, 0);

  const [pesoKg, setPesoKg] = useState('');
  const [almacenId, setAlmacenId] = useState('');
  const [contenedor, setContenedor] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [embalajes, setEmbalajes] = useState<EmbalajeLote[]>([]);
  const [anulando, setAnulando] = useState<{ id: string; motivo: string } | null>(null);

  const cargarEmbalajes = useCallback(() => { obtenerEmbalajes(lote.id).then(setEmbalajes); }, [lote.id]);
  useEffect(() => { cargarEmbalajes(); }, [cargarEmbalajes]);

  const kg = Number(pesoKg.replace(',', '.'));
  const nombreAlmacen = (id: string | null) =>
    id ? lote.stockPorAlmacen.find(s => s.almacenId === id)?.almacenNombre ?? 'Otro almacén' : 'Sin almacén';

  const handleMarcar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!Number.isFinite(kg) || kg <= 0) { setError('Indica los kilos embalados (mayor a 0).'); return; }
    setGuardando(true);
    const result = await marcarEmbalado(lote.id, {
      pesoKg: kg,
      almacenId: almacenId || null,
      contenedor: contenedor.trim() || undefined,
      nota: nota.trim() || undefined,
    });
    setGuardando(false);
    if ('error' in result) { setError(result.error); return; }
    toast.exito(`${fmt(kg)} kg de ${lote.nombre} marcados como embalados.`);
    if (result.advertencia) toast.advertencia(result.advertencia);
    setPesoKg(''); setNota(''); setContenedor('');
    cargarEmbalajes();
    onCambio();
  };

  const handleAnular = async () => {
    if (!anulando) return;
    if (anulando.motivo.trim().length < 3) { setError('Indica el motivo de la anulación.'); return; }
    setError(null);
    const result = await anularEmbalaje(lote.id, anulando.id, anulando.motivo.trim());
    if ('error' in result) { setError(result.error); return; }
    toast.exito('Embalaje anulado.');
    if (result.advertencia) toast.advertencia(result.advertencia);
    setAnulando(null);
    cargarEmbalajes();
    onCambio();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-surface">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Embalado de {lote.nombre}</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Stock {fmt(lote.stockKg)} kg · embalado {fmt(lote.embalado?.embaladoKg ?? 0)} kg · en saca {fmt(enSaca)} kg
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors shrink-0">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {lote.embalado?.embaladoMayorQueStock && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              Hay {fmt(lote.embalado.embaladoMarcadoKg)} kg marcados como embalados, pero el lote solo tiene {fmt(lote.stockKg)} kg
              (se vendió, despachó o transformó parte). Anula los embalajes que ya no apliquen.
            </div>
          )}

          {puedeEditar && (
            <form onSubmit={handleMarcar} className="space-y-3">
              <div>
                <label className={labelClass}>Kilos embalados *</label>
                <input type="number" step="0.001" min="0.001" value={pesoKg} onChange={e => setPesoKg(e.target.value)} className={inputClass} placeholder={`Hasta ${fmt(enSaca)} kg en saca`} />
              </div>
              {lote.stockPorAlmacen.length > 0 && (
                <div>
                  <label className={labelClass}>Almacén (opcional)</label>
                  <select value={almacenId} onChange={e => setAlmacenId(e.target.value)} className={inputClass}>
                    <option value="">— Sin especificar —</option>
                    {lote.stockPorAlmacen.map(s => (
                      <option key={s.almacenId} value={s.almacenId}>
                        {s.almacenNombre} ({fmt(s.enSacaKg ?? s.stockKg)} kg en saca)
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelClass}>Contenedor (opcional)</label>
                  <input type="text" maxLength={80} value={contenedor} onChange={e => setContenedor(e.target.value)} className={inputClass} placeholder="Ej. Contenedor 1" />
                </div>
                <div>
                  <label className={labelClass}>Nota (opcional)</label>
                  <input type="text" maxLength={500} value={nota} onChange={e => setNota(e.target.value)} className={inputClass} placeholder="Ej. sacas 1 a 12" />
                </div>
              </div>
              {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3"><p className="text-red-600 text-sm">{error}</p></div>}
              <button type="submit" disabled={guardando} className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
                {guardando ? <><Loader2 size={16} className="animate-spin" /> Guardando...</> : 'Marcar kg como embalados'}
              </button>
            </form>
          )}

          <div>
            <h3 className="text-xs font-semibold text-text-secondary mb-2">Embalajes vigentes</h3>
            {embalajes.length === 0 ? (
              <p className="text-xs text-text-muted">Todavía no hay kilos marcados como embalados.</p>
            ) : (
              <ul className="space-y-1.5">
                {embalajes.map(e => (
                  <li key={e.id} className="border border-border rounded-lg px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-semibold text-text-primary">{fmt(e.pesoKg)} kg</span>
                        <span className="text-text-muted"> · {nombreAlmacen(e.almacenId)}{e.contenedor ? ` · ${e.contenedor}` : ''}</span>
                        <p className="text-text-muted truncate">
                          {new Date(e.marcadoEn).toLocaleDateString('es-VE')}{e.marcadoPorNombre ? ` · ${e.marcadoPorNombre}` : ''}{e.nota ? ` · ${e.nota}` : ''}
                        </p>
                      </div>
                      {puedeEditar && (
                        <button type="button" onClick={() => setAnulando({ id: e.id, motivo: '' })} className="flex items-center gap-1 text-text-muted hover:text-red-600 shrink-0" title="Anular embalaje">
                          <Undo2 size={13} /> Anular
                        </button>
                      )}
                    </div>
                    {anulando?.id === e.id && (
                      <div className="mt-2 flex gap-2">
                        <input type="text" maxLength={300} value={anulando.motivo} onChange={ev => setAnulando({ id: e.id, motivo: ev.target.value })} className={inputClass} placeholder="Motivo de la anulación" />
                        <button type="button" onClick={handleAnular} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 shrink-0">Anular</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default MarcarEmbaladoModal;
