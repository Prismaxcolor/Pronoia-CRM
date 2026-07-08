import { useState } from 'react';
import { X, Plus, Trash2, Loader2 } from 'lucide-react';
import { completarTicket } from '../../services/ticket-pesaje-service';
import { useToast } from '../../hooks/use-toast';
import type { Producto, TicketPesaje, Lote } from '@shared/types/index.js';

interface Props {
  ticket: TicketPesaje;
  productos: Producto[];
  lotes: Lote[];
  onClose: () => void;
  onCompletado: () => void;
}

/** Valor del selector de destino: 'mpp' o el id de un lote. */
type DestinoValor = 'mpp' | string;

interface MaterialFila {
  uid: number;
  productoId: string;
  subcategoria: string;
  pesoBruto: string;
  tara: string;
  devolucion: string;
  destino: DestinoValor;
}

let UID = 0;
function filaVacia(): MaterialFila {
  return { uid: UID++, productoId: '', subcategoria: '', pesoBruto: '', tara: '', devolucion: '', destino: 'mpp' };
}

function netoFila(f: MaterialFila): number {
  return (Number(f.pesoBruto) || 0) - (Number(f.tara) || 0) - (Number(f.devolucion) || 0);
}

function CompletarTicketModal({ ticket, productos, lotes, onClose, onCompletado }: Props) {
  const toast = useToast();
  const [materiales, setMateriales] = useState<MaterialFila[]>([filaVacia()]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setFila = (uid: number, campo: keyof MaterialFila, valor: string) =>
    setMateriales(prev => prev.map(f => (f.uid === uid ? { ...f, [campo]: valor } : f)));

  const agregarMaterial = () => setMateriales(prev => [...prev, filaVacia()]);
  const quitarMaterial = (uid: number) =>
    setMateriales(prev => (prev.length > 1 ? prev.filter(f => f.uid !== uid) : prev));

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (materiales.some(f => !f.productoId)) { setError('Cada material debe tener un producto seleccionado.'); return; }
    if (materiales.some(f => netoFila(f) <= 0)) { setError('Cada material debe tener un peso neto mayor a 0.'); return; }

    setGuardando(true);
    const result = await completarTicket(ticket.id, materiales.map(f => ({
      productoId: f.productoId,
      subcategoria: f.subcategoria.trim() || null,
      pesoBruto: Number(f.pesoBruto) || 0,
      tara: Number(f.tara) || 0,
      devolucion: Number(f.devolucion) || 0,
      destinoTipo: f.destino === 'mpp' ? ('mpp' as const) : ('lote' as const),
      loteId: f.destino === 'mpp' ? null : f.destino,
    })));
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
            const neto = netoFila(f);
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

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={labelClass}>Peso bruto (kg)</label>
                    <input type="number" step="0.01" min="0" value={f.pesoBruto} onChange={e => setFila(f.uid, 'pesoBruto', e.target.value)} className={inputClass} placeholder="0.00" />
                  </div>
                  <div>
                    <label className={labelClass}>Tara (kg)</label>
                    <input type="number" step="0.01" min="0" value={f.tara} onChange={e => setFila(f.uid, 'tara', e.target.value)} className={inputClass} placeholder="0.00" />
                  </div>
                  <div>
                    <label className={labelClass}>Devolución (kg)</label>
                    <input type="number" step="0.01" min="0" value={f.devolucion} onChange={e => setFila(f.uid, 'devolucion', e.target.value)} className={inputClass} placeholder="0.00" />
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">Neto del material</span>
                  <span className={`font-semibold ${neto < 0 ? 'text-red-600' : 'text-text-primary'}`}>{neto.toFixed(2)} kg</span>
                </div>
              </div>
            );
          })}

          <button type="button" onClick={agregarMaterial} className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors">
            <Plus size={16} />
            Agregar material
          </button>

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
