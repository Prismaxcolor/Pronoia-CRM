import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Tara } from '@shared/types/index.js';
import SeleccionarTaraModal from './SeleccionarTaraModal';
import CantidadTaraInput from './CantidadTaraInput';
import TarasExtraEditor from './TarasExtraEditor';
import { taraTotalKg, type ConTarasExtra, type TaraUnidad } from './tara-multiple';

type FilaConTara = TaraUnidad & ConTarasExtra;

interface Props {
  fila: FilaConTara;
  taras: Tara[];
  /** Cambios parciales sobre la fila (modo, tara, cantidad, manual, extras). */
  onChange: (cambios: Partial<FilaConTara>) => void;
}

const inputClass = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
const toggleClass = (activo: boolean) => `px-2 py-1 ${activo ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`;
const fmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

/** Tara de una fila (principal + adicionales) con el mismo esquema que el pesaje: preconfigurada
 *  (tara × cantidad) o manual en kg, más taras extra. Para formularios que no son el de pesaje. */
function TaraFilaEditor({ fila, taras, onChange }: Props) {
  const [selectorAbierto, setSelectorAbierto] = useState(false);

  const elegirTara = (taraId: string) => {
    onChange({ taraId, taraCantidad: taraId ? (fila.taraCantidad || '1') : '' });
    setSelectorAbierto(false);
  };

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-xs text-text-muted mb-1">Tara</label>
        <div className="flex rounded-md overflow-hidden border border-border text-[11px] w-fit mb-1.5">
          <button type="button" onClick={() => onChange({ taraModo: 'preconfigurada' })} className={toggleClass(fila.taraModo === 'preconfigurada')}>Preconfigurada</button>
          <button type="button" onClick={() => onChange({ taraModo: 'manual' })} className={toggleClass(fila.taraModo === 'manual')}>Manual</button>
        </div>
        {fila.taraModo === 'preconfigurada' ? (
          <div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setSelectorAbierto(true)} className={`${inputClass} flex items-center justify-between gap-2 text-left`}>
                <span className={fila.taraId ? 'text-text-primary truncate' : 'text-text-muted'}>
                  {taras.find(t => t.id === fila.taraId)?.nombre ?? '— Sin tara —'}
                </span>
                <ChevronDown size={14} className="text-text-muted shrink-0" />
              </button>
              <CantidadTaraInput value={fila.taraCantidad} onChange={v => onChange({ taraCantidad: v })} />
            </div>
            <p className="text-[11px] text-text-muted mt-1">= {fmt(taraTotalKg({ ...fila, tarasExtra: [] }, taras))} kg</p>
          </div>
        ) : (
          <input type="number" step="0.001" min="0" value={fila.taraManual} onChange={e => onChange({ taraManual: e.target.value })} className={inputClass} placeholder="0.000" />
        )}
      </div>

      <TarasExtraEditor extras={fila.tarasExtra ?? []} taras={taras} onChange={tarasExtra => onChange({ tarasExtra })} />

      {selectorAbierto && (
        <SeleccionarTaraModal
          taras={taras}
          taraSeleccionada={fila.taraId || undefined}
          onClose={() => setSelectorAbierto(false)}
          onSeleccionar={elegirTara}
        />
      )}
    </div>
  );
}

export default TaraFilaEditor;
