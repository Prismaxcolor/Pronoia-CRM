import { Plus, Trash2 } from 'lucide-react';
import FotoMaterialPicker from './FotoMaterialPicker';
import { netoPesajeGlobalFila, pesajeGlobalVacio, sumaPesajesGlobales, type PesajeGlobalFila } from './pesaje-global-fila';

interface Props {
  pesajes: PesajeGlobalFila[];
  onChange: (siguiente: PesajeGlobalFila[]) => void;
}

const inputClass = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
const labelClass = 'block text-xs font-medium text-text-secondary mb-1';

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

/** Edición de las pesadas del camión (peso, tara y fotos de cada una) de un
 *  ticket existente. Inmutable: cada cambio entrega un arreglo nuevo. */
function PesajesGlobalesEditor({ pesajes, onChange }: Props) {
  const actualizar = (uid: number, parcial: Partial<PesajeGlobalFila>) =>
    onChange(pesajes.map(p => (p.uid === uid ? { ...p, ...parcial } : p)));

  return (
    <div className="space-y-2">
      <label className={labelClass + ' mb-0'}>Pesaje global (pesadas del camión)</label>
      {pesajes.map((f, idx) => {
        const neto = netoPesajeGlobalFila(f);
        return (
          <div key={f.uid} className="border border-border rounded-lg p-3 space-y-2 bg-surface-alt/40">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text-secondary">Pesaje {idx + 1}</span>
              {pesajes.length > 1 && (
                <button type="button" onClick={() => onChange(pesajes.filter(p => p.uid !== f.uid))} className="text-text-muted hover:text-red-600 transition-colors" title="Quitar pesaje">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Peso bruto (kg)</label>
                <input type="number" step="0.001" min="0" value={f.peso} onChange={e => actualizar(f.uid, { peso: e.target.value })} className={inputClass} placeholder="0.000" />
              </div>
              <div>
                <label className={labelClass}>Tara (kg)</label>
                <input type="number" step="0.001" min="0" value={f.tara} onChange={e => actualizar(f.uid, { tara: e.target.value })} className={inputClass} placeholder="0.000" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 text-sm">
              <span className="text-text-muted">Neto</span>
              <span className={`font-semibold ${neto < 0 ? 'text-red-600' : 'text-text-primary'}`}>{fmt(neto)} kg</span>
            </div>
            <FotoMaterialPicker
              label="Fotos del pesaje"
              fotos={f.fotos}
              onAgregar={files => actualizar(f.uid, {
                fotos: [...f.fotos, ...files.map(file => ({ tipo: 'nueva' as const, file, preview: URL.createObjectURL(file) }))],
              })}
              onQuitar={i => actualizar(f.uid, { fotos: f.fotos.filter((_, k) => k !== i) })}
            />
          </div>
        );
      })}
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => onChange([...pesajes, pesajeGlobalVacio()])} className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors">
          <Plus size={16} />
          Agregar pesaje
        </button>
        <span className="text-xs text-text-secondary">
          Peso global: <span className="font-semibold text-text-primary">{fmt(sumaPesajesGlobales(pesajes))} kg</span>
        </span>
      </div>
    </div>
  );
}

export default PesajesGlobalesEditor;
