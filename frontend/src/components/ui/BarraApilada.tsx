import { formatearNumero } from '../../lib/formato';

/** CUÁNDO USARLA: mostrar de qué partes se compone UN total (kg por etapa, limpio vs sucio). Es la alternativa a la
 *  torta para 2 a 5 partes. La leyenda es TEXTO (etiqueta + valor): el color solo refuerza. 'columnas' = leyenda en
 *  rejilla de 3 con el valor debajo; 'fila' = leyenda corrida con porcentaje. */
export interface SegmentoApilado {
  clave: string;
  etiqueta: string;
  valor: number;
  color: string;
}

export interface BarraApiladaProps {
  segmentos: ReadonlyArray<SegmentoApilado>;
  /** Formato del valor en la leyenda (por defecto número es-VE). Incluye la unidad: p. ej. formatearKg. */
  formatoValor?: (valor: number) => string;
  leyenda?: 'columnas' | 'fila';
  /** Alto de la barra (clase Tailwind). */
  alto?: string;
  /** Prefijo del resumen accesible ("Kilos por etapa"). */
  rotulo?: string;
}

function BarraApilada({ segmentos, formatoValor = v => formatearNumero(v, 0), leyenda = 'columnas', alto = 'h-3', rotulo }: BarraApiladaProps) {
  const total = segmentos.reduce((s, x) => s + (x.valor > 0 ? x.valor : 0), 0);
  const descripcion = segmentos.map(s => `${s.etiqueta} ${formatoValor(s.valor)}`).join(', ');
  const aria = rotulo ? `${rotulo}: ${descripcion}` : descripcion;
  return (
    <div>
      {total > 0 ? (
        <div role="img" aria-label={aria} className={`flex ${alto} w-full overflow-hidden rounded-full bg-surface-hover`}>
          {segmentos.filter(s => s.valor > 0).map(s => (
            <div key={s.clave} style={{ width: `${(s.valor / total) * 100}%`, backgroundColor: s.color }} />
          ))}
        </div>
      ) : (
        <div className={`${alto} w-full rounded-full bg-surface-hover`} aria-hidden="true" />
      )}
      {leyenda === 'columnas' ? (
        <ul className="mt-1.5 grid grid-cols-3 gap-1 text-[11px] leading-tight text-text-secondary">
          {segmentos.map(s => (
            <li key={s.clave}>
              <span className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ backgroundColor: s.color }} aria-hidden="true" />
              {s.etiqueta}
              <span className="block font-medium tabular-nums text-text-primary">{formatoValor(s.valor)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-secondary">
          {segmentos.map(s => (
            <li key={s.clave}>
              <span className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ backgroundColor: s.color }} aria-hidden="true" />
              {s.etiqueta} <span className="font-medium tabular-nums text-text-primary">{formatoValor(s.valor)}</span>{' '}
              <span className="tabular-nums">({formatearNumero(total > 0 ? (s.valor / total) * 100 : 0, 0)} %)</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default BarraApilada;
