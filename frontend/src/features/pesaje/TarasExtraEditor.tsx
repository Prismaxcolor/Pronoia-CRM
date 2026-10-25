import { useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import type { Tara } from '@shared/types/index.js';
import SeleccionarTaraModal from './SeleccionarTaraModal';
import CantidadTaraInput from './CantidadTaraInput';
import { taraUnidadKg, taraUnidadVacia, type TaraUnidad } from './tara-multiple';

interface Props {
  extras: TaraUnidad[];
  taras: Tara[];
  onChange: (extras: TaraUnidad[]) => void;
}

const inputClass = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
const toggleClass = (activo: boolean) => `px-2 py-1 ${activo ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`;
const fmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

/** Taras adicionales de un material (p. ej. saca + cesta a la vez). Cada una es
 *  preconfigurada (tara × cantidad) o manual; todas se suman a la tara principal. */
function TarasExtraEditor({ extras, taras, onChange }: Props) {
  const [indiceActivo, setIndiceActivo] = useState<number | null>(null);

  const actualizar = (indice: number, cambios: Partial<TaraUnidad>) =>
    onChange(extras.map((e, i) => (i === indice ? { ...e, ...cambios } : e)));
  const quitar = (indice: number) => onChange(extras.filter((_, i) => i !== indice));
  const agregar = () => onChange([...extras, taraUnidadVacia()]);

  const elegirTara = (taraId: string) => {
    if (indiceActivo === null) return;
    const actual = extras[indiceActivo];
    actualizar(indiceActivo, { taraId, taraCantidad: taraId ? (actual?.taraCantidad || '1') : '' });
    setIndiceActivo(null);
  };

  return (
    <div className="space-y-2">
      {extras.map((e, i) => (
        <div key={i} className="rounded-lg border border-border p-2 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-text-secondary">Tara adicional {i + 1}</span>
            <div className="flex items-center gap-2">
              <div className="flex rounded-md overflow-hidden border border-border text-[11px]">
                <button type="button" onClick={() => actualizar(i, { taraModo: 'preconfigurada' })} className={toggleClass(e.taraModo === 'preconfigurada')}>Preconfigurada</button>
                <button type="button" onClick={() => actualizar(i, { taraModo: 'manual' })} className={toggleClass(e.taraModo === 'manual')}>Manual</button>
              </div>
              <button type="button" onClick={() => quitar(i)} aria-label={`Quitar tara adicional ${i + 1}`} className="text-text-muted hover:text-red-600">
                <X size={16} />
              </button>
            </div>
          </div>
          {e.taraModo === 'preconfigurada' ? (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setIndiceActivo(i)} className={`${inputClass} flex items-center justify-between gap-1 text-left`}>
                <span className={e.taraId ? 'text-text-primary truncate' : 'text-text-muted'}>
                  {taras.find(t => t.id === e.taraId)?.nombre ?? '— Tara —'}
                </span>
                <ChevronDown size={14} className="text-text-muted shrink-0" />
              </button>
              <CantidadTaraInput value={e.taraCantidad} onChange={v => actualizar(i, { taraCantidad: v })} />
            </div>
          ) : (
            <input type="number" step="0.001" min="0" value={e.taraManual} onChange={ev => actualizar(i, { taraManual: ev.target.value })} className={inputClass} placeholder="0.00" />
          )}
          <p className="text-[11px] text-text-muted">= {fmt(taraUnidadKg(e, taras))} kg</p>
        </div>
      ))}
      <button type="button" onClick={agregar} className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
        <Plus size={14} /> Agregar otra tara
      </button>

      {indiceActivo !== null && (
        <SeleccionarTaraModal
          taras={taras}
          taraSeleccionada={extras[indiceActivo]?.taraId || undefined}
          onClose={() => setIndiceActivo(null)}
          onSeleccionar={elegirTara}
        />
      )}
    </div>
  );
}

export default TarasExtraEditor;
