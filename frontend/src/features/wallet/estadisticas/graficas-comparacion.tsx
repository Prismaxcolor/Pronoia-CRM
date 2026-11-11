import { useMemo } from 'react';
import { AnuncioActivo, TooltipGrafica } from '../../../components/ui/graficas/compartido';
import { calcularEjeY, escalaLineal, posicionesX, rutaCurvaMonotona, type Punto } from '../../../lib/graficas';
import { formatearCompacto } from '../../../lib/formato';
import { TablaAccesible } from './elementos';
import { etiquetasEjeX, indicesEtiquetasLegibles, type PuntoComparacion } from './estadisticas-curvas';
import {
  ALTO_GRAFICA, ANCHO_GRAFICA, CURVA_ACTUAL, CURVA_ANIO_PASADO, CURVA_ANTERIOR, MARGEN_GRAFICA, MAX_ETIQUETAS_X, margenIzquierdo, type EstiloCurva,
} from './graficas-estilos';
import { useCursorGrafica } from './useCursorGrafica';

interface Props {
  puntos: readonly PuntoComparacion[];
  terminaHoy: boolean;
  ocultar: boolean;
  fmt: (monto: number) => string;
  /** "Flujo", "Gastos" o "Ingresos". */
  metrica: string;
  etiquetaAria: string;
}

type ClaveSerie = 'actual' | 'anterior' | 'anioPasado';
const SERIES: ReadonlyArray<{ clave: ClaveSerie; estilo: EstiloCurva }> = [
  { clave: 'anioPasado', estilo: CURVA_ANIO_PASADO },
  { clave: 'anterior', estilo: CURVA_ANTERIOR },
  { clave: 'actual', estilo: CURVA_ACTUAL },
];

const hayDatos = (puntos: readonly PuntoComparacion[], c: ClaveSerie): boolean => puntos.some(p => p[c] !== null);
const sinDato = 'sin dato';

/** Curvas acumuladas día a día: período actual (continua), anterior (punteada) y, si hay historial, el mismo período del año
 *  pasado (guiones). Una curva sin datos NO se dibuja (nunca una línea plana en cero). */
export default function GraficaComparacion({ puntos, terminaHoy, ocultar, fmt, metrica, etiquetaAria }: Props) {
  const izq = margenIzquierdo(ocultar);
  const { arriba, abajo, derecha } = MARGEN_GRAFICA;
  const geo = useMemo(() => {
    const valores = puntos.flatMap(p => [p.actual, p.anterior, p.anioPasado]).filter((v): v is number => v !== null);
    const eje = calcularEjeY(Math.min(...valores), Math.max(...valores), 4);
    const y = escalaLineal(eje.max, eje.min, arriba, ALTO_GRAFICA - abajo);
    const xs = posicionesX(puntos.length, izq + 4, ANCHO_GRAFICA - derecha - 4);
    return { eje, y, xs };
  }, [puntos, izq, arriba, abajo, derecha]);
  const { eje, y, xs } = geo;
  const { ref: refGrafica, escala, indice, manejadores } = useCursorGrafica(xs, ANCHO_GRAFICA);
  const trazado = (c: ClaveSerie): Punto[] => puntos.flatMap((p, i) => (p[c] === null ? [] : [{ x: xs[i], y: y(p[c] as number) }]));
  const etiquetasX = etiquetasEjeX(puntos.map(p => p.etiqueta), 'dia', terminaHoy);
  const activo = indice === null ? null : puntos[indice];
  const valorDe = (p: PuntoComparacion, c: ClaveSerie): string => (p[c] === null ? sinDato : fmt(p[c] as number));
  const texto = activo ? `${activo.etiqueta}: período actual ${valorDe(activo, 'actual')}, anterior ${valorDe(activo, 'anterior')}, año pasado ${valorDe(activo, 'anioPasado')}` : '';

  return (
    <figure className="m-0">
      <div
        ref={refGrafica}
        role="group"
        tabIndex={0}
        aria-label={`${etiquetaAria}. Usa las flechas para recorrer los días.`}
        {...manejadores}
        className="relative touch-pan-y rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento"
      >
        <svg viewBox={`0 0 ${ANCHO_GRAFICA} ${ALTO_GRAFICA}`} className="block h-auto w-full" aria-hidden="true">
          {eje.ticks.map(t => (
            <g key={t}>
              <line x1={izq} x2={ANCHO_GRAFICA - derecha} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-w-texto2' : 'stroke-w-borde'} strokeWidth={t === 0 ? 1 : 0.5} />
              {!ocultar && <text x={izq - 6} y={y(t) + 4} textAnchor="end" className="fill-w-texto2" fontSize="11">{formatearCompacto(t)}</text>}
            </g>
          ))}
          {xs.map((x, i) => <line key={puntos[i].dia} x1={x} x2={x} y1={arriba} y2={ALTO_GRAFICA - abajo} className={indice === i ? 'stroke-w-texto2' : 'stroke-w-grupo'} strokeWidth={indice === i ? 1 : 0.6} strokeDasharray={indice === i ? '3 3' : undefined} />)}
          {SERIES.filter(s => hayDatos(puntos, s.clave)).map(s => (
            <path key={s.clave} d={rutaCurvaMonotona(trazado(s.clave))} fill="none" stroke={s.estilo.color} strokeWidth={s.estilo.grosor} strokeDasharray={s.estilo.trazo || undefined} strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {indice !== null && SERIES.filter(s => puntos[indice as number][s.clave] !== null).map(s => (
            <circle key={s.clave} cx={xs[indice as number]} cy={y(puntos[indice as number][s.clave] as number)} r={4} fill={s.estilo.color} className="stroke-w-tarjeta" strokeWidth={2} />
          ))}
          {indicesEtiquetasLegibles(etiquetasX, xs, MAX_ETIQUETAS_X).map(i => (
            <text key={puntos[i].dia} x={xs[i]} y={ALTO_GRAFICA - 8} textAnchor={i === 0 ? 'start' : i === puntos.length - 1 ? 'end' : 'middle'} className="fill-w-texto2" fontSize="11" fontWeight={i === puntos.length - 1 && terminaHoy ? 700 : 400}>{etiquetasX[i]}</text>
          ))}
        </svg>
        {activo && indice !== null && (
          <TooltipGrafica x={xs[indice] * escala} y={y(activo.actual) * escala} anchoContenedor={ANCHO_GRAFICA * escala}>
            <p className="font-semibold">{activo.etiqueta} · acumulado de {metrica.toLowerCase()}</p>
            <p className="tabular-nums">Actual {valorDe(activo, 'actual')}</p>
            {hayDatos(puntos, 'anterior') && <p className="tabular-nums">Anterior {valorDe(activo, 'anterior')}</p>}
            {hayDatos(puntos, 'anioPasado') && <p className="tabular-nums">Año pasado {valorDe(activo, 'anioPasado')}</p>}
          </TooltipGrafica>
        )}
      </div>
      <AnuncioActivo texto={texto} />
      <TablaAccesible
        titulo={etiquetaAria}
        columnas={['Día', 'Período actual', 'Período anterior', 'Mismo período del año pasado']}
        filas={puntos.map(p => [p.etiqueta, fmt(p.actual), valorDe(p, 'anterior'), valorDe(p, 'anioPasado')])}
      />
    </figure>
  );
}
