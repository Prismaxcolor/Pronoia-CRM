import { Plus, Trash2 } from 'lucide-react';
import type { Lote } from '@shared/types/index.js';
import FotoMaterialPicker from './FotoMaterialPicker';
import { INPUT_CLASS, LABEL_CLASS } from './pesaje-clases';
import { formatearKgPesaje, opcionesLoteFila, stockLoteEnAlmacen } from './pesaje-nuevo-logica';
import { netoLoteTrasladoFila, type LoteTrasladoFila } from './lote-traslado-fila';

interface Props {
  loteFilas: LoteTrasladoFila[];
  lotes: Lote[];
  /** Lotes con stock en el almacén de origen elegido. */
  lotesEnOrigen: Lote[];
  almacenOrigenId: string;
  onAgregar: () => void;
  onQuitar: (uid: number) => void;
  onCampo: (uid: number, campo: 'loteId' | 'pesoBruto' | 'tara', valor: string) => void;
  onAgregarFotos: (uid: number, files: File[]) => void;
  onQuitarFoto: (uid: number, idx: number) => void;
}

/** La composición que viaja es la de ESTE almacén de origen (se congela al pesar), no la del lote en otro almacén. */
function ComposicionDelLote({ lote, almacenOrigenId }: { lote: Lote | undefined; almacenOrigenId: string }) {
  const composicion = lote?.stockPorAlmacen.find(s => s.almacenId === almacenOrigenId)?.composicion ?? [];
  if (composicion.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {composicion.map(c => (
        <span key={c.item} className="text-[11px] bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
          {c.item}: {c.porcentaje}%
        </span>
      ))}
    </div>
  );
}

function LoteTrasladoCard({ fila: f, numero, p }: { fila: LoteTrasladoFila; numero: number; p: Props }) {
  const neto = netoLoteTrasladoFila(f);
  const opciones = opcionesLoteFila(p.lotesEnOrigen, p.loteFilas, f);
  const loteSel = p.lotes.find(l => l.id === f.loteId);
  return (
    <div className="border border-border rounded-lg p-3 space-y-3 bg-surface-alt/40">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text-secondary">Lote {numero}</span>
        <button type="button" onClick={() => p.onQuitar(f.uid)} className="text-text-muted hover:text-red-600 transition-colors" title="Quitar lote">
          <Trash2 size={15} />
        </button>
      </div>
      <div>
        <label className={LABEL_CLASS}>Lote *</label>
        <select value={f.loteId} onChange={e => p.onCampo(f.uid, 'loteId', e.target.value)} className={INPUT_CLASS}>
          <option value="">— Selecciona —</option>
          {opciones.map(l => (
            <option key={l.id} value={l.id}>{l.nombre} ({formatearKgPesaje(stockLoteEnAlmacen(l, p.almacenOrigenId))} kg en este almacén)</option>
          ))}
        </select>
        {f.loteId && (
          <p className="text-[11px] text-text-muted mt-1">Disponible en este almacén: {formatearKgPesaje(stockLoteEnAlmacen(loteSel, p.almacenOrigenId))} kg</p>
        )}
        {f.loteId && <ComposicionDelLote lote={loteSel} almacenOrigenId={p.almacenOrigenId} />}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL_CLASS}>Peso bruto (kg)</label>
          <input type="number" step="0.001" min="0" value={f.pesoBruto} onChange={e => p.onCampo(f.uid, 'pesoBruto', e.target.value)} className={INPUT_CLASS} placeholder="0.00" />
        </div>
        <div>
          <label className={LABEL_CLASS}>Tara (kg)</label>
          <input type="number" step="0.001" min="0" value={f.tara} onChange={e => p.onCampo(f.uid, 'tara', e.target.value)} className={INPUT_CLASS} placeholder="0.00" />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 text-sm">
        <span className="text-text-muted">Neto del lote</span>
        <span className={`font-semibold ${neto < 0 ? 'text-red-600' : 'text-text-primary'}`}>{formatearKgPesaje(neto)} kg</span>
      </div>
      <FotoMaterialPicker fotos={f.fotos} onAgregar={files => p.onAgregarFotos(f.uid, files)} onQuitar={idx => p.onQuitarFoto(f.uid, idx)} />
    </div>
  );
}

/** Lotes (PCB) completos que se trasladan, cada uno pesado con su tara y foto. Solo aplica a traslado. */
function LotesTrasladarSeccion(p: Props) {
  return (
    <div className="space-y-3">
      <label className={LABEL_CLASS + ' mb-0'}>Lotes a trasladar (PCB)</label>

      {p.loteFilas.map((f, idx) => <LoteTrasladoCard key={f.uid} fila={f} numero={idx + 1} p={p} />)}

      <button type="button" onClick={p.onAgregar} disabled={p.lotesEnOrigen.length === 0} className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
        <Plus size={16} />
        Agregar lote
      </button>
      {p.lotesEnOrigen.length === 0 && <p className="text-xs text-text-muted">No hay lotes con stock en el almacén de origen.</p>}
      <p className="text-xs text-text-muted">Puedes trasladar una porción del lote (pésala) — el resto sigue en el almacén de origen. Llega al destino cuando se confirme la recepción.</p>
    </div>
  );
}

export default LotesTrasladarSeccion;
