import { useMemo, useState } from 'react';
import { X, Plus, Trash2, Loader2, Scale } from 'lucide-react';
import { completarTicket } from '../../services/ticket-pesaje-service';
import { useToast } from '../../hooks/use-toast';
import { filaVacia, taraKgFila, netoFila, type MaterialFila } from './material-fila';
import type { Producto, TicketPesaje, Lote, Tara } from '@shared/types/index.js';

interface Props {
  ticket: TicketPesaje;
  productos: Producto[];
  lotes: Lote[];
  taras: Tara[];
  onClose: () => void;
  onCompletado: () => void;
}

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function CompletarTicketModal({ ticket, productos, lotes, taras, onClose, onCompletado }: Props) {
  const toast = useToast();
  const [materiales, setMateriales] = useState<MaterialFila[]>([filaVacia()]);
  const [devolucion, setDevolucion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setFila = (uid: number, campo: keyof MaterialFila, valor: string) =>
    setMateriales(prev => prev.map(f => (f.uid === uid ? { ...f, [campo]: valor } : f)));

  const agregarMaterial = () => setMateriales(prev => [...prev, filaVacia()]);
  const quitarMaterial = (uid: number) =>
    setMateriales(prev => (prev.length > 1 ? prev.filter(f => f.uid !== uid) : prev));

  const pesoNetoTotal = useMemo(
    () => materiales.reduce((acc, f) => acc + netoFila(f, taras), 0),
    [materiales, taras]
  );

  // Bugfix: el peso global se toma del ticket guardado en bruto (no de un input
  // nuevo) para que la diferencia se calcule en vivo mientras se cargan los materiales.
  const diferencia = useMemo(
    () => ticket.pesoGlobal - pesoNetoTotal - (Number(devolucion) || 0),
    [ticket.pesoGlobal, pesoNetoTotal, devolucion]
  );

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (materiales.some(f => !f.productoId)) { setError('Cada material debe tener un producto seleccionado.'); return; }
    if (materiales.some(f => f.taraModo === 'preconfigurada' && Number(f.taraCantidad) > 0 && !f.taraId)) {
      setError('Selecciona la tara preconfigurada para las unidades ingresadas.');
      return;
    }
    if (materiales.some(f => netoFila(f, taras) <= 0)) { setError('Cada material debe tener un peso neto mayor a 0.'); return; }

    setGuardando(true);
    const result = await completarTicket(ticket.id, materiales.map(f => ({
      productoId: f.productoId,
      subcategoria: f.subcategoria.trim() || null,
      pesoBruto: Number(f.pesoBruto) || 0,
      tara: taraKgFila(f, taras),
      destinoTipo: f.destino === 'mpp' ? ('mpp' as const) : ('lote' as const),
      loteId: f.destino === 'mpp' ? null : f.destino,
    })), Number(devolucion) || 0);
    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    toast.exito(`${result.ticket.codigo} completado.`);
    onCompletado();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">Completar {ticket.codigo}</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <p className="text-xs text-text-muted">
            Este ticket se guardó en bruto. Registra los materiales y destinos definitivos para que se contabilice en el inventario.
          </p>

          {materiales.map((f, idx) => {
            const neto = netoFila(f, taras);
            return (
              <div key={f.uid} className="border border-border rounded-lg p-3 space-y-3 bg-surface-alt/40">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-text-secondary">Material {idx + 1}</span>
                  {materiales.length > 1 && (
                    <button type="button" onClick={() => quitarMaterial(f.uid)} className="text-text-muted hover:text-red-600 transition-colors" title="Quitar material">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Material *</label>
                    <select value={f.productoId} onChange={e => setFila(f.uid, 'productoId', e.target.value)} className={inputClass}>
                      <option value="">— Selecciona —</option>
                      {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Subcategoría / detalle</label>
                    <input type="text" value={f.subcategoria} onChange={e => setFila(f.uid, 'subcategoria', e.target.value)} className={inputClass} placeholder="Ej. PCB media densidad" />
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Destino (inventario) *</label>
                  <select value={f.destino} onChange={e => setFila(f.uid, 'destino', e.target.value)} className={inputClass}>
                    <option value="mpp">MPP (Material Por Procesar)</option>
                    {lotes.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Peso bruto (kg)</label>
                    <input type="number" step="0.01" min="0" value={f.pesoBruto} onChange={e => setFila(f.uid, 'pesoBruto', e.target.value)} className={inputClass} placeholder="0.00" />
                  </div>
                  <div>
                    <label className={labelClass}>Tara</label>
                    <div className="flex rounded-md overflow-hidden border border-border text-[11px] w-fit mb-1.5">
                      <button type="button" onClick={() => setFila(f.uid, 'taraModo', 'preconfigurada')} className={`px-2 py-1 ${f.taraModo === 'preconfigurada' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
                        Preconfigurada
                      </button>
                      <button type="button" onClick={() => setFila(f.uid, 'taraModo', 'manual')} className={`px-2 py-1 ${f.taraModo === 'manual' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
                        Manual
                      </button>
                    </div>
                    {f.taraModo === 'preconfigurada' ? (
                      <div>
                        <div className="grid grid-cols-2 gap-2">
                          <select value={f.taraId} onChange={e => setFila(f.uid, 'taraId', e.target.value)} className={inputClass}>
                            <option value="">— Tara —</option>
                            {taras.map(t => <option key={t.id} value={t.id}>{t.nombre} ({t.peso} kg)</option>)}
                          </select>
                          <input type="number" step="1" min="0" value={f.taraCantidad} onChange={e => setFila(f.uid, 'taraCantidad', e.target.value)} className={inputClass} placeholder="Cantidad" />
                        </div>
                        <p className="text-[11px] text-text-muted mt-1">= {fmt(taraKgFila(f, taras))} kg</p>
                      </div>
                    ) : (
                      <input type="number" step="0.01" min="0" value={f.taraManual} onChange={e => setFila(f.uid, 'taraManual', e.target.value)} className={inputClass} placeholder="0.00" />
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">Neto del material</span>
                  <span className={`font-semibold ${neto < 0 ? 'text-red-600' : 'text-text-primary'}`}>{fmt(neto)} kg</span>
                </div>
              </div>
            );
          })}

          <button type="button" onClick={agregarMaterial} className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors">
            <Plus size={16} />
            Agregar material
          </button>

          <div className="bg-brand-50 border border-brand-200 rounded-lg px-4 py-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-brand-800">Peso global (de este pesaje)</span>
              <span className="font-semibold text-brand-700">{fmt(ticket.pesoGlobal)} kg</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium text-brand-800">
                <Scale size={16} />
                Suma de materiales
              </span>
              <span className={`text-lg font-bold ${pesoNetoTotal < 0 ? 'text-red-600' : 'text-brand-700'}`}>
                {fmt(pesoNetoTotal)} kg
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm border-t border-brand-200 pt-2">
              <label htmlFor="devolucion-completar" className="text-brand-800 shrink-0">Devolución (kg)</label>
              <input
                id="devolucion-completar"
                type="number"
                step="0.01"
                min="0"
                value={devolucion}
                onChange={e => setDevolucion(e.target.value)}
                className="w-28 px-2 py-1 bg-surface border border-brand-200 rounded-md text-sm text-right focus:outline-none focus:ring-2 focus:ring-brand-400"
                placeholder="0.00"
              />
            </div>
            <div className="flex items-center justify-between text-sm border-t border-brand-200 pt-2">
              <span className="text-brand-800">Diferencia (global vs. neto + devolución)</span>
              <span className={`font-semibold ${Math.abs(diferencia) > 0.01 ? 'text-amber-600' : 'text-brand-700'}`}>
                {fmt(diferencia)} kg
              </span>
            </div>
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? <><Loader2 size={16} className="animate-spin" /> Guardando...</> : 'Completar ticket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CompletarTicketModal;
