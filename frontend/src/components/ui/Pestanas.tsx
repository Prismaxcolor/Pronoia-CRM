import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

/** CUÁNDO USARLAS: secciones paralelas de una misma pantalla (Resumen | Movimientos | Historial) de las que se ve UNA
 *  a la vez. Si solo cambia el filtro de lo que muestra un bloque, usa ControlSegmentado. Pasa el panel activo como
 *  `children`; el componente enlaza tab y panel con aria-controls/aria-labelledby y soporta flechas, Inicio y Fin. */
export interface PestanaDef<V extends string> {
  valor: V;
  etiqueta: string;
  /** Conteo o dato corto a la derecha de la etiqueta. */
  sufijo?: ReactNode;
}

export interface PestanasProps<V extends string> {
  pestanas: ReadonlyArray<PestanaDef<V>>;
  valor: V;
  onCambiar: (valor: V) => void;
  etiquetaAria: string;
  /** Contenido de la pestaña activa. */
  children?: ReactNode;
}

function Pestanas<V extends string>({ pestanas, valor, onCambiar, etiquetaAria, children }: PestanasProps<V>) {
  const base = useId();
  const lista = useRef<HTMLDivElement>(null);
  const idTab = (v: string) => `${base}-tab-${v}`;
  const idPanel = `${base}-panel`;

  const alTecla = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = pestanas.findIndex(p => p.valor === valor);
    let destino: number;
    if (e.key === 'ArrowRight') destino = (i + 1) % pestanas.length;
    else if (e.key === 'ArrowLeft') destino = (i - 1 + pestanas.length) % pestanas.length;
    else if (e.key === 'Home') destino = 0;
    else if (e.key === 'End') destino = pestanas.length - 1;
    else return;
    e.preventDefault();
    const nueva = pestanas[destino].valor;
    onCambiar(nueva);
    requestAnimationFrame(() => lista.current?.querySelector<HTMLButtonElement>(`[id="${idTab(nueva)}"]`)?.focus());
  };

  return (
    <div>
      <div ref={lista} role="tablist" aria-label={etiquetaAria} onKeyDown={alTecla} className="mb-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border">
        {pestanas.map(p => {
          const activa = p.valor === valor;
          return (
            <button
              key={p.valor}
              id={idTab(p.valor)}
              type="button"
              role="tab"
              aria-selected={activa}
              aria-controls={idPanel}
              tabIndex={activa ? 0 : -1}
              onClick={() => onCambiar(p.valor)}
              className={`-mb-px whitespace-nowrap border-b-2 px-3.5 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${activa ? 'border-brand-600 text-brand-700' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
            >
              {p.etiqueta}
              {p.sufijo !== undefined && <span className="ml-1.5 text-xs tabular-nums text-text-muted">{p.sufijo}</span>}
            </button>
          );
        })}
      </div>
      {children !== undefined && <div role="tabpanel" id={idPanel} aria-labelledby={idTab(valor)}>{children}</div>}
    </div>
  );
}

export default Pestanas;
