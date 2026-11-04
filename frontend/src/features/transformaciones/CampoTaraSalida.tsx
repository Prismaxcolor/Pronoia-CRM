import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Tara } from '@shared/types/index.js';
import SeleccionarTaraModal from '../pesaje/SeleccionarTaraModal';
import CantidadTaraInput from '../pesaje/CantidadTaraInput';
import { seleccionarTaraFila, taraKgFila, type CampoTara } from '../pesaje/material-fila';

const inputClass = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400';
const labelClass = 'block text-xs font-medium text-text-secondary mb-1';

const fmtKg = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

interface Props {
  valor: CampoTara;
  taras: Tara[];
  onCambiar: (campos: Partial<CampoTara>) => void;
}

/** Tara de una salida de transformación: igual que en los pesajes normales, una tara de la tabla de
 *  taras (× cantidad) o un kg manual. Lo usan todos los tipos de transformación (ferroso y PCB). */
function CampoTaraSalida({ valor, taras, onCambiar }: Props) {
  const [mostrarSelector, setMostrarSelector] = useState(false);
  const claseModo = (activo: boolean) => `px-2 py-1 ${activo ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`;

  return (
    <div>
      <label className={labelClass}>Tara</label>
      <div className="flex rounded-md overflow-hidden border border-border text-[11px] w-fit mb-1.5">
        <button type="button" onClick={() => onCambiar({ taraModo: 'preconfigurada' })} className={claseModo(valor.taraModo === 'preconfigurada')}>
          Preconfigurada
        </button>
        <button type="button" onClick={() => onCambiar({ taraModo: 'manual' })} className={claseModo(valor.taraModo === 'manual')}>
          Manual
        </button>
      </div>
      {valor.taraModo === 'preconfigurada' ? (
        <div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMostrarSelector(true)} className={`${inputClass} flex items-center justify-between gap-2 text-left`}>
              <span className={valor.taraId ? 'text-text-primary truncate' : 'text-text-muted'}>
                {taras.find(t => t.id === valor.taraId)?.nombre ?? '— Sin tara —'}
              </span>
              <ChevronDown size={14} className="text-text-muted shrink-0" />
            </button>
            <CantidadTaraInput value={valor.taraCantidad} onChange={v => onCambiar({ taraCantidad: v })} />
          </div>
          <p className="text-[11px] text-text-muted mt-1">= {fmtKg(taraKgFila(valor, taras))} kg</p>
        </div>
      ) : (
        <input type="number" step="0.001" min="0" value={valor.taraManual} onChange={e => onCambiar({ taraManual: e.target.value })} className={inputClass} placeholder="0.00" />
      )}
      {mostrarSelector && (
        <SeleccionarTaraModal
          taras={taras}
          taraSeleccionada={valor.taraId || undefined}
          onClose={() => setMostrarSelector(false)}
          onSeleccionar={taraId => { onCambiar(seleccionarTaraFila(valor, taraId)); setMostrarSelector(false); }}
        />
      )}
    </div>
  );
}

export default CampoTaraSalida;
