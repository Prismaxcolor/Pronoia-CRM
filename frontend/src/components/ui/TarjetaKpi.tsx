import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { formatearNumero } from '../../lib/formato';
import type { ComparacionPeriodo } from '../../lib/comparacion';
import InfoTooltip from './InfoTooltip';

/** CUÁNDO USARLO: un indicador clave (valor grande + contexto). Máximo 4 por fila (GrillaKpis). Regla: el valor lleva
 *  su unidad ("1.234 kg", "USD 5.000"), el subtítulo dice de dónde sale, y la comparación solo se muestra si hay periodo
 *  anterior (con `comparacion={null}` sale "—": no se inventa nada). El rojo del valor es solo para umbrales reales. */

const TONO_CLASE = { bueno: 'text-brand-700', malo: 'text-red-700', neutro: 'text-text-secondary' } as const;

export interface ComparacionKpiProps {
  /** null = sin periodo anterior (muestra "—"). */
  cmp: ComparacionPeriodo | null;
  /** Formatea el cambio absoluto (por defecto número con 1 decimal). */
  formato?: (delta: number) => string;
}

/** Comparación vs periodo anterior con flecha, texto y semántica bueno/malo (no depende solo del color: lleva flecha y aria-label). */
export function ComparacionKpi({ cmp, formato }: ComparacionKpiProps) {
  if (!cmp) {
    return <p className="mt-2 text-xs text-text-muted" title="No hay datos de un periodo anterior para comparar, por eso no se muestra si subió o bajó.">vs periodo anterior: —</p>;
  }
  const Icono = cmp.direccion === 'sube' ? ArrowUp : cmp.direccion === 'baja' ? ArrowDown : Minus;
  const texto = cmp.direccion === 'igual' ? 'Sin cambio' : formato ? formato(Math.abs(cmp.delta)) : formatearNumero(Math.abs(cmp.delta), 1);
  const sentido = cmp.direccion === 'igual' ? 'sin cambio' : `${cmp.direccion === 'sube' ? 'subió' : 'bajó'} ${cmp.tono === 'bueno' ? '(favorable)' : cmp.tono === 'malo' ? '(desfavorable)' : ''}`;
  return (
    <p className={`mt-2 flex items-center gap-1 text-xs font-medium ${TONO_CLASE[cmp.tono]}`} aria-label={`Frente al periodo anterior ${sentido}: ${texto}`}>
      <Icono size={14} aria-hidden="true" /> {texto} <span className="font-normal text-text-muted">vs periodo anterior</span>
    </p>
  );
}

export interface TarjetaKpiProps {
  titulo: string;
  icono?: ReactNode;
  /** Explicación del "?": 1 a 3 frases cortas con qué muestra la cifra y cómo se calcula (qué se suma o compara, desde qué fecha, con unidad). */
  ayuda?: ReactNode;
  /** Valor grande, ya formateado con su unidad. */
  valor?: ReactNode;
  /** Unidad pequeña junto al valor, cuando no va incluida en `valor` (p. ej. "kg"). */
  unidad?: string;
  /** Línea bajo el valor: aclara a qué se refiere la cifra (periodo, filtro o base del cálculo). */
  subtitulo?: ReactNode;
  /** Contenido extra (desgloses, mini gráfica). */
  children?: ReactNode;
  /** undefined = sin fila de comparación; null = "vs periodo anterior: —"; objeto = flecha y cambio. */
  comparacion?: ComparacionPeriodo | null;
  formatoDelta?: (delta: number) => string;
  /** 'listo' (por defecto), 'cargando' (skeleton interno), 'vacio' (sin datos), 'sinPermiso'. */
  estado?: 'listo' | 'cargando' | 'vacio' | 'sinPermiso';
  /** Texto del estado vacío. */
  mensajeVacio?: string;
  /** 'peligro' pinta el valor en rojo: solo cuando supera un umbral real. */
  tonoValor?: 'normal' | 'peligro';
}

/** Tarjeta de indicador: título + "?" + valor grande + subtítulo + (extras) + comparación. */
function TarjetaKpi({
  titulo, icono, ayuda, valor, unidad, subtitulo, children, comparacion, formatoDelta,
  estado = 'listo', mensajeVacio = 'Sin datos en este periodo', tonoValor = 'normal',
}: TarjetaKpiProps) {
  return (
    <article className="rounded-xl border border-border bg-surface p-4" aria-busy={estado === 'cargando'}>
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-text-secondary">
          {icono && <span className="text-brand-600" aria-hidden="true">{icono}</span>}
          {titulo}
        </h3>
        {ayuda && <InfoTooltip etiqueta={`Qué significa: ${titulo}`}>{ayuda}</InfoTooltip>}
      </header>
      {estado === 'cargando' ? (
        <div className="space-y-2" aria-label="Cargando">
          <div className="h-7 w-2/3 animate-pulse rounded bg-surface-hover" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-surface-hover" />
        </div>
      ) : estado === 'sinPermiso' ? (
        <p className="text-sm text-text-secondary">Sin permiso para ver valores</p>
      ) : estado === 'vacio' ? (
        <>
          <p className="text-2xl font-bold text-text-primary tabular-nums">—</p>
          <p className="text-xs text-text-secondary">{mensajeVacio}</p>
        </>
      ) : (
        <>
          {valor !== undefined && (
            <p className={`text-2xl font-bold tabular-nums ${tonoValor === 'peligro' ? 'text-red-700' : 'text-text-primary'}`}>
              {valor}
              {unidad && <span className="ml-1 text-sm font-medium text-text-secondary">{unidad}</span>}
            </p>
          )}
          {subtitulo && <p className="text-xs text-text-secondary">{subtitulo}</p>}
          {children}
        </>
      )}
      {comparacion !== undefined && estado !== 'cargando' && estado !== 'sinPermiso' &&<ComparacionKpi cmp={comparacion} formato={formatoDelta} />}
    </article>
  );
}

export default TarjetaKpi;
