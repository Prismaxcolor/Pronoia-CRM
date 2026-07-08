import { ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  open: boolean;
  onToggle: () => void;
  /** Contenido de la cabecera (icono, título, totales...). El chevron se antepone automáticamente. */
  header: React.ReactNode;
  children: React.ReactNode;
}

/** Panel desplegable genérico: cabecera clicable con chevron + contenido colapsable. */
function Accordion({ open, onToggle, header, children }: Props) {
  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-surface-alt transition-colors"
      >
        {open ? <ChevronDown size={18} className="text-text-muted shrink-0" /> : <ChevronRight size={18} className="text-text-muted shrink-0" />}
        {header}
      </button>

      {open && <div className="border-t border-border">{children}</div>}
    </div>
  );
}

export default Accordion;
