import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';

interface InfoTooltipProps {
  /** Texto accesible del botón ("Qué significa: Valor total"). */
  etiqueta: string;
  children: ReactNode;
}

/** Ícono "?" con explicación. Se abre al pasar el mouse, al enfocar con teclado y al tocar (móvil);
 *  Escape o tocar fuera lo cierra. El texto está enlazado con aria-describedby. */
function InfoTooltip({ etiqueta, children }: InfoTooltipProps) {
  const id = useId();
  const [fijo, setFijo] = useState(false);
  const [hover, setHover] = useState(false);
  const contenedor = useRef<HTMLSpanElement>(null);
  const visible = fijo || hover;

  useEffect(() => {
    if (!fijo) return;
    const fuera = (e: Event) => {
      if (contenedor.current && !contenedor.current.contains(e.target as Node)) setFijo(false);
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setFijo(false); };
    document.addEventListener('pointerdown', fuera);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('pointerdown', fuera);
      document.removeEventListener('keydown', tecla);
    };
  }, [fijo]);

  return (
    <span
      ref={contenedor}
      className="relative inline-flex"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        aria-label={etiqueta}
        aria-expanded={visible}
        aria-describedby={visible ? id : undefined}
        onClick={() => setFijo(v => !v)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className="text-text-muted hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded-full"
      >
        <HelpCircle size={16} aria-hidden="true" />
      </button>
      {visible && (
        <span
          id={id}
          role="tooltip"
          className="absolute right-0 top-full z-30 mt-1.5 w-64 max-w-[calc(100vw-3rem)] rounded-lg border border-border bg-surface p-3 text-xs font-normal leading-relaxed text-text-secondary shadow-lg"
        >
          {children}
        </span>
      )}
    </span>
  );
}

export default InfoTooltip;
