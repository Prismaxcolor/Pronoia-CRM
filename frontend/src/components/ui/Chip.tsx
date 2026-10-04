import type { ReactNode } from 'react';
import { X } from 'lucide-react';

/** CUÁNDO USARLO: (1) filtro activo que se puede quitar ("Filtrando: PCB" con ×) con `onQuitar`; (2) opción de filtro
 *  alternable con `onClick` + `seleccionado` (aria-pressed). Para elegir UNA opción entre pocas usa ControlSegmentado. */
export interface ChipProps {
  children: ReactNode;
  /** Muestra la × y la llama al quitar. */
  onQuitar?: () => void;
  /** Texto accesible de la ×, p. ej. "Quitar filtro PCB". */
  etiquetaQuitar?: string;
  /** Modo alternable (botón con aria-pressed). */
  onClick?: () => void;
  seleccionado?: boolean;
}

function Chip({ children, onQuitar, etiquetaQuitar = 'Quitar filtro', onClick, seleccionado = false }: ChipProps) {
  if (onClick) {
    return (
      <button
        type="button"
        aria-pressed={seleccionado}
        onClick={onClick}
        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${seleccionado ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-border bg-surface text-text-secondary hover:bg-surface-hover'}`}
      >
        {children}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-brand-300 bg-brand-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-brand-800">
      {children}
      {onQuitar && (
        <button type="button" onClick={onQuitar} aria-label={etiquetaQuitar} className="rounded-full p-0.5 hover:bg-brand-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

export default Chip;
