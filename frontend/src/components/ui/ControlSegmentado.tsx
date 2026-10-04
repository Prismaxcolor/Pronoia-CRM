import { useRef, type KeyboardEvent, type ReactNode } from 'react';

/** CUÁNDO USARLO: elegir UNA vista entre 2 a 5 opciones que cambian lo que muestra el bloque (Exportación | Venta
 *  nacional | Trabajo interno). Es un radiogroup: flechas del teclado cambian la opción y la activa es la única con tabIndex 0.
 *  `sufijo` agrega un dato a la derecha de cada etiqueta (p. ej. los kg de esa vista). */
export interface OpcionSegmentada<V extends string> {
  valor: V;
  etiqueta: string;
  sufijo?: ReactNode;
}

export interface ControlSegmentadoProps<V extends string> {
  opciones: ReadonlyArray<OpcionSegmentada<V>>;
  valor: V;
  onCambiar: (valor: V) => void;
  /** Texto accesible del grupo ("Vista del inventario"). */
  etiquetaAria: string;
}

function ControlSegmentado<V extends string>({ opciones, valor, onCambiar, etiquetaAria }: ControlSegmentadoProps<V>) {
  const contenedor = useRef<HTMLDivElement>(null);
  const alTecla = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = opciones.findIndex(o => o.valor === valor);
    const paso = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!paso || i < 0) return;
    e.preventDefault();
    const nueva = opciones[(i + paso + opciones.length) % opciones.length].valor;
    onCambiar(nueva);
    requestAnimationFrame(() => contenedor.current?.querySelector<HTMLButtonElement>(`[data-valor="${CSS.escape(nueva)}"]`)?.focus());
  };
  return (
    <div ref={contenedor} role="radiogroup" aria-label={etiquetaAria} onKeyDown={alTecla} className="inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-surface-hover p-1">
      {opciones.map(o => {
        const activa = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            data-valor={o.valor}
            aria-checked={activa}
            tabIndex={activa ? 0 : -1}
            onClick={() => onCambiar(o.valor)}
            className={`rounded-lg px-3.5 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${activa ? 'bg-brand-600 text-white shadow-sm' : 'text-text-secondary hover:bg-surface hover:text-text-primary'}`}
          >
            {o.etiqueta}
            {o.sufijo !== undefined && <span className={`ml-1.5 text-xs tabular-nums ${activa ? 'text-brand-100' : 'text-text-muted'}`}>{o.sufijo}</span>}
          </button>
        );
      })}
    </div>
  );
}

export default ControlSegmentado;
