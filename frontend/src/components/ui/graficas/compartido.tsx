import type { ReactNode } from 'react';

/** Piezas comunes de las gráficas SVG ligeras: medición del ancho disponible, tooltip accesible, leyenda en texto y
 *  tabla oculta con los datos (resumen para lectores de pantalla). No se usan solas: las importan las gráficas. */

export interface TooltipGraficaProps {
  /** Posición del punto de anclaje dentro del contenedor, en píxeles. */
  x: number;
  y: number;
  /** Ancho del contenedor, para no salirse por los lados. */
  anchoContenedor: number;
  children: ReactNode;
}

const ANCHO_TOOLTIP = 168;

/** Tooltip flotante sobre la gráfica. No captura el puntero; el mismo texto se anuncia por la región aria-live. */
export function TooltipGrafica({ x, y, anchoContenedor, children }: TooltipGraficaProps) {
  const izq = Math.min(Math.max(x - ANCHO_TOOLTIP / 2, 0), Math.max(0, anchoContenedor - ANCHO_TOOLTIP));
  return (
    <div
      aria-hidden="true"
      style={{ left: izq, top: Math.max(0, y - 8), width: ANCHO_TOOLTIP }}
      className="pointer-events-none absolute z-20 -translate-y-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs leading-snug text-text-primary shadow-lg"
    >
      {children}
    </div>
  );
}

export interface ItemLeyenda { etiqueta: string; color: string }

/** Leyenda en texto con cuadrito de color (el color nunca es la única pista). */
export function LeyendaGrafica({ items }: { items: ReadonlyArray<ItemLeyenda> }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-secondary" aria-label="Leyenda">
      {items.map(i => (
        <li key={i.etiqueta}>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ backgroundColor: i.color }} aria-hidden="true" />
          {i.etiqueta}
        </li>
      ))}
    </ul>
  );
}

/** Tabla solo para lectores de pantalla con los mismos datos que la gráfica. */
export function TablaOculta({ titulo, encabezados, filas }: { titulo: string; encabezados: readonly string[]; filas: ReadonlyArray<ReadonlyArray<string>> }) {
  return (
    <table className="sr-only">
      <caption>{titulo}</caption>
      <thead><tr>{encabezados.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
      <tbody>{filas.map((f, i) => <tr key={i}>{f.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody>
    </table>
  );
}

/** Región aria-live que anuncia el elemento activo (hover, foco o flechas). */
export function AnuncioActivo({ texto }: { texto: string }) {
  return <p className="sr-only" aria-live="polite">{texto}</p>;
}
