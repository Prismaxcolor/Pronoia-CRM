import { useMemo, useState } from 'react';
import { angulosDona, porcionesDona, rutaArco, type ItemDona } from '../../../lib/graficas';
import { formatearNumero, formatearPct } from '../../../lib/formato';
import { COLOR_OTROS, colorDeSerie } from '../../../lib/paleta';
import EstadoVacio from '../EstadoVacio';

/** CUÁNDO USARLA: composición de un total en 2 a 5 partes (kg por categoría, ingresos por tipo). Máximo 5 porciones:
 *  si hay más, el resto se agrupa en "Otros" automáticamente. Nunca 3D. La leyenda es TEXTO con valor y porcentaje (el
 *  color no va solo) y resalta la porción al pasar el mouse o enfocar. Con muchas categorías o comparaciones finas usa
 *  BarrasHorizontales. */
export interface DonaProps {
  items: ReadonlyArray<ItemDona>;
  /** Formato del valor (incluye la unidad). */
  formatoValor?: (v: number) => string;
  /** Rótulo del total en el centro ("Total"). */
  rotuloTotal?: string;
  etiquetaAria: string;
  mensajeVacio?: string;
  /** Diámetro en píxeles (por defecto 148). */
  tamano?: number;
}

const R_EXT = 56;
const R_INT = 36;

function Dona({ items, formatoValor = v => formatearNumero(v, 0), rotuloTotal = 'Total', etiquetaAria, mensajeVacio = 'Sin datos para graficar en este periodo.', tamano = 148 }: DonaProps) {
  const [activa, setActiva] = useState<number | null>(null);
  const porciones = useMemo(() => porcionesDona(items), [items]);
  const angulos = useMemo(() => angulosDona(porciones), [porciones]);
  const total = porciones.reduce((s, p) => s + p.valor, 0);

  if (porciones.length === 0) return <EstadoVacio mensaje={mensajeVacio} />;

  const colorDe = (i: number) => porciones[i].color ?? (porciones[i].esOtros ? COLOR_OTROS : colorDeSerie(i));
  const sel = activa === null ? null : porciones[activa];

  return (
    <figure className="m-0 flex flex-col items-center gap-4 sm:flex-row sm:items-center" aria-label={etiquetaAria}>
      <div className="relative shrink-0" style={{ width: tamano, height: tamano }}>
        <svg viewBox="0 0 120 120" width={tamano} height={tamano} aria-hidden="true" className="block">
          {porciones.map((p, i) => (
            <path
              key={p.etiqueta}
              d={rutaArco(60, 60, R_EXT, R_INT, angulos[i][0], angulos[i][1])}
              fillRule="evenodd"
              style={{ fill: colorDe(i), opacity: activa === null || activa === i ? 1 : 0.45 }}
              stroke="#fff"
              strokeWidth={porciones.length > 1 ? 1.5 : 0}
              onMouseEnter={() => setActiva(i)}
              onMouseLeave={() => setActiva(null)}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[11px] text-text-secondary">{sel ? sel.etiqueta : rotuloTotal}</span>
          <span className="text-sm font-bold tabular-nums text-text-primary">{formatoValor(sel ? sel.valor : total)}</span>
          {sel && <span className="text-[11px] tabular-nums text-text-secondary">{formatearPct(sel.pct, 0)}</span>}
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-1 text-sm" aria-label="Leyenda">
        {porciones.map((p, i) => (
          <li
            key={p.etiqueta}
            tabIndex={0}
            onMouseEnter={() => setActiva(i)}
            onMouseLeave={() => setActiva(null)}
            onFocus={() => setActiva(i)}
            onBlur={() => setActiva(null)}
            className="flex items-center gap-2 rounded px-1 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colorDe(i) }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-text-primary">{p.etiqueta}</span>
            <span className="font-medium tabular-nums text-text-primary">{formatoValor(p.valor)}</span>
            <span className="w-12 text-right text-xs tabular-nums text-text-secondary">{formatearPct(p.pct, 0)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export default Dona;
