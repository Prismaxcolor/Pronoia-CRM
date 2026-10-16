import { Plus, Trash2 } from 'lucide-react';
import type { Tara } from '@shared/types/index.js';
import FotoMaterialPicker from '../pesaje/FotoMaterialPicker';
import CampoTaraSalida from './CampoTaraSalida';
import {
  MAX_PESADAS_ENTRADA, netoPesadaEntrada, pesadaEntradaVacia, totalesEntrada, type PesadaEntradaForm,
} from '../../lib/entrada-pesadas';

const inputClass = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400';
const labelClass = 'block text-xs font-medium text-text-secondary mb-1';
const fmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

interface Props {
  pesadas: PesadaEntradaForm[];
  taras: Tara[];
  onCambiar: (pesadas: PesadaEntradaForm[]) => void;
}

/** Pesadas de la entrada de una transformación: cada una con peso bruto, tara y fotos; se suman en el neto de entrada.
 *  Con una sola pesada se ve igual que el formulario de siempre. */
function PesadasEntradaCampo({ pesadas, taras, onCambiar }: Props) {
  const varias = pesadas.length > 1;
  const total = totalesEntrada(pesadas, taras);

  const actualizar = (uid: number, cambios: Partial<PesadaEntradaForm>) =>
    onCambiar(pesadas.map(p => (p.uid === uid ? { ...p, ...cambios } : p)));
  const quitar = (uid: number) => onCambiar(pesadas.filter(p => p.uid !== uid));
  const agregar = () => onCambiar([...pesadas, pesadaEntradaVacia()]);

  return (
    <div className="space-y-3">
      {pesadas.map((p, idx) => (
        <div key={p.uid} className={varias ? 'rounded-lg border border-border bg-surface-alt/50 p-3 space-y-3' : 'space-y-3'}>
          {varias && (
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text-secondary">Pesada {idx + 1}</span>
              <button type="button" onClick={() => quitar(p.uid)} className="text-text-muted hover:text-red-500" title="Quitar esta pesada" aria-label={`Quitar pesada ${idx + 1}`}>
                <Trash2 size={14} />
              </button>
            </div>
          )}
          <div>
            <label className={labelClass}>Peso bruto (kg) *</label>
            <input
              type="number" step="0.001" min="0.001" required value={p.pesoBruto}
              onChange={e => actualizar(p.uid, { pesoBruto: e.target.value })}
              className={inputClass} placeholder="0.00"
            />
          </div>
          <CampoTaraSalida valor={p} taras={taras} onCambiar={campos => actualizar(p.uid, campos)} />
          <FotoMaterialPicker
            fotos={p.fotos}
            onAgregar={files => actualizar(p.uid, { fotos: [...p.fotos, ...files.map(file => ({ tipo: 'nueva' as const, file, preview: URL.createObjectURL(file) }))] })}
            onQuitar={i => actualizar(p.uid, { fotos: p.fotos.filter((_, k) => k !== i) })}
            label={varias ? `Fotos de la pesada ${idx + 1} *` : 'Fotos de entrada *'}
          />
          {varias && (
            <p className="text-[11px] text-text-muted">Neto de esta pesada: <span className="font-medium text-text-primary">{fmt(netoPesadaEntrada(p, taras))} kg</span></p>
          )}
        </div>
      ))}

      <button
        type="button" onClick={agregar} disabled={pesadas.length >= MAX_PESADAS_ENTRADA}
        className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 disabled:opacity-50"
      >
        <Plus size={15} /> Agregar otra pesada
      </button>

      <p className="text-xs text-text-muted">
        {varias && <>Total: {fmt(total.bruto)} kg brutos − {fmt(total.tara)} kg de tara · </>}
        Neto a retirar: <span className="font-semibold text-text-primary">{fmt(total.neto)} kg</span>
      </p>
    </div>
  );
}

export default PesadasEntradaCampo;
