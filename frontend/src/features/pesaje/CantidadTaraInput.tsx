import { Minus, Plus } from 'lucide-react';

interface Props {
  /** Texto del input (mismo formato que `taraCantidad`: string numérico o vacío). */
  value: string;
  onChange: (valor: string) => void;
  ariaLabel?: string;
}

const MINIMO = 1;
const botonClass = 'shrink-0 w-10 h-10 flex items-center justify-center bg-surface-alt border border-border text-text-secondary hover:bg-brand-50 hover:text-brand-700 disabled:opacity-40 disabled:hover:bg-surface-alt focus:outline-none focus:ring-2 focus:ring-brand-400';

/** Cantidad de taras preconfigurada: botones − / + además de poder teclearla. Entero, mínimo 1. */
function CantidadTaraInput({ value, onChange, ariaLabel = 'Cantidad de taras' }: Props) {
  const actual = Math.floor(Number(value)) || 0;
  const cambiar = (n: number) => onChange(String(Math.max(MINIMO, n)));

  return (
    <div className="flex items-stretch min-w-0">
      <button type="button" onClick={() => cambiar(actual - 1)} disabled={actual <= MINIMO} aria-label={`${ariaLabel}: disminuir`} className={`${botonClass} rounded-l-lg`}>
        <Minus size={16} />
      </button>
      <input
        type="number"
        inputMode="numeric"
        step="1"
        min={MINIMO}
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label={ariaLabel}
        placeholder="Cant."
        className="w-full min-w-0 h-10 px-1 text-center text-sm bg-surface-alt border-y border-border focus:outline-none focus:ring-2 focus:ring-brand-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button type="button" onClick={() => cambiar(actual + 1)} aria-label={`${ariaLabel}: aumentar`} className={`${botonClass} rounded-r-lg`}>
        <Plus size={16} />
      </button>
    </div>
  );
}

export default CantidadTaraInput;
