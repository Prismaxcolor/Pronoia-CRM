import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { porcentajesDeMaximo } from '../../../lib/graficas';
import { formatearNumero } from '../../../lib/formato';
import { COLOR_MARCA } from '../../../lib/paleta';
import EstadoVacio from '../EstadoVacio';

/** CUÁNDO USARLA: ranking o comparación de pocas categorías con nombres largos (kg por proveedor, valor por material).
 *  Cada fila trae etiqueta, barra y el VALOR EN TEXTO (no hace falta tooltip ni tabla oculta: la lista ya es legible por lectores de pantalla). Ordena de mayor a
 *  menor por defecto y recorta con `maxFilas`. Si pasas `to`, la fila es un enlace a la acción o detalle. */
export interface DatoBarraHorizontal {
  etiqueta: string;
  valor: number;
  color?: string;
  /** Símbolo de apoyo junto a la etiqueta (p. ej. el de la categoría): el color no va solo. */
  simbolo?: string;
  /** Texto secundario bajo la etiqueta. */
  detalle?: string;
  to?: string;
}

export interface BarrasHorizontalesProps {
  datos: ReadonlyArray<DatoBarraHorizontal>;
  /** Formato del valor (incluye la unidad). */
  formatoValor?: (v: number) => string;
  ordenar?: boolean;
  maxFilas?: number;
  etiquetaAria: string;
  mensajeVacio?: string;
}

function BarrasHorizontales({ datos, formatoValor = v => formatearNumero(v, 0), ordenar = true, maxFilas, etiquetaAria, mensajeVacio = 'Sin datos para graficar en este periodo.' }: BarrasHorizontalesProps) {
  const filas = useMemo(() => {
    const base = ordenar ? [...datos].sort((a, b) => b.valor - a.valor) : [...datos];
    return maxFilas ? base.slice(0, maxFilas) : base;
  }, [datos, ordenar, maxFilas]);
  const pct = useMemo(() => porcentajesDeMaximo(filas.map(f => f.valor)), [filas]);

  if (filas.length === 0 || filas.every(f => !(f.valor > 0))) return <EstadoVacio mensaje={mensajeVacio} />;

  return (
    <figure className="m-0">
      <ul aria-label={etiquetaAria} className="space-y-2">
        {filas.map((f, i) => {
          const etiqueta = (
            <>
              <span className="block truncate text-sm text-text-primary">
                {f.simbolo && <span aria-hidden="true" className="mr-1" style={{ color: f.color }}>{f.simbolo}</span>}
                {f.etiqueta}
              </span>
              {f.detalle && <span className="block truncate text-[11px] text-text-secondary">{f.detalle}</span>}
            </>
          );
          return (
            <li key={`${i}-${f.etiqueta}`} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-x-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto]" title={`${f.etiqueta}: ${formatoValor(f.valor)}`}>
              {f.to ? <Link to={f.to} className="min-w-0 rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">{etiqueta}</Link> : <div className="min-w-0">{etiqueta}</div>}
              <svg width="100%" height="12" aria-hidden="true" className="block">
                <rect x="0" y="0" width="100%" height="12" rx="6" className="fill-surface-hover" />
                <rect x="0" y="0" width={`${pct[i]}%`} height="12" rx="6" style={{ fill: f.color ?? COLOR_MARCA }} />
              </svg>
              <span className="text-right text-sm font-medium tabular-nums text-text-primary">{formatoValor(f.valor)}</span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

export default BarrasHorizontales;
