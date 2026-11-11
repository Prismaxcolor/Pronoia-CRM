import { useMemo } from 'react';
import { AnuncioActivo, TooltipGrafica } from '../../../components/ui/graficas/compartido';
import { apilarCategoria, calcularEjeY, escalaLineal, geometriaBarras } from '../../../lib/graficas';
import { formatearCompacto } from '../../../lib/formato';
import { TablaAccesible } from './elementos';
import { etiquetasEjeX, indicesEtiquetasLegibles } from './estadisticas-curvas';
import type { PuntoGastoTipo, VistaGastos } from './estadisticas-gastos';
import type { Granularidad } from './estadisticas-logica';
import {
  ALTO_GRAFICA, ANCHO_GRAFICA, COLOR_GASTO_TOTAL, MARGEN_GRAFICA, MAX_ETIQUETAS_X, PREFIJO_TRAMO, SERIES_TIPO, margenIzquierdo,
} from './graficas-estilos';
import { useCursorGrafica } from './useCursorGrafica';

interface Props {
  puntos: readonly PuntoGastoTipo[];
  vista: VistaGastos;
  granularidad: Granularidad;
  terminaHoy: boolean;
  ocultar: boolean;
  fmt: (monto: number) => string;
  etiquetaAria: string;
}

/** Barras de gastos por tramo: total (una barra) o apiladas por tipo (pagos, adelantos, otros). Pista gris por tramo,
 *  tooltip con ratón/toque/flechas y tabla para lectores de pantalla. */
export default function GraficaGastos({ puntos, vista, granularidad, terminaHoy, ocultar, fmt, etiquetaAria }: Props) {
  const izq = margenIzquierdo(ocultar);
  const { arriba, abajo, derecha } = MARGEN_GRAFICA;
  const geo = useMemo(() => {
    const eje = calcularEjeY(0, Math.max(0, ...puntos.map(p => p.total)), 4);
    const y = escalaLineal(eje.max, eje.min, arriba, ALTO_GRAFICA - abajo);
    const barras = geometriaBarras(puntos.length, ANCHO_GRAFICA - izq - derecha, 0.35);
    return { eje, y, barras, centros: barras.xs.map(x => izq + x + barras.ancho / 2) };
  }, [puntos, izq, arriba, abajo, derecha]);
  const { eje, y, barras, centros } = geo;
  const { ref: refGrafica, escala, indice, manejadores } = useCursorGrafica(centros, ANCHO_GRAFICA);
  const etiquetasX = etiquetasEjeX(puntos.map(p => p.etiqueta), granularidad, terminaHoy);
  const activo = indice === null ? null : puntos[indice];
  const lineaTipos = (p: PuntoGastoTipo): string => `pagos ${fmt(p.pagos)}, adelantos ${fmt(p.adelantos)}, otros egresos ${fmt(p.otros)}`;
  const textoActivo = activo ? `${PREFIJO_TRAMO[granularidad]}${activo.etiqueta}: total ${fmt(activo.total)}${vista === 'tipo' ? `; ${lineaTipos(activo)}` : ''}` : '';

  return (
    <figure className="m-0">
      <div
        ref={refGrafica}
        role="group"
        tabIndex={0}
        aria-label={`${etiquetaAria}. Usa las flechas para recorrer los tramos.`}
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
          {puntos.map((p, i) => {
            const x = izq + barras.xs[i];
            const tramos = vista === 'tipo' ? apilarCategoria(SERIES_TIPO.map(s => p[s.clave])).segmentos : [{ indiceSerie: 0, valor: p.total, desde: 0, hasta: p.total }];
            return (
              <g key={p.clave}>
                <rect x={x} width={barras.ancho} y={arriba} height={ALTO_GRAFICA - abajo - arriba} rx={3} className={indice === i ? 'fill-w-borde' : 'fill-w-grupo'} />
                {tramos.filter(t => t.valor > 0).map(t => (
                  <rect key={t.indiceSerie} x={x} width={barras.ancho} y={y(t.hasta)} height={Math.max(0, y(t.desde) - y(t.hasta))} style={{ fill: vista === 'tipo' ? SERIES_TIPO[t.indiceSerie].color : COLOR_GASTO_TOTAL }} />
                ))}
              </g>
            );
          })}
          {indicesEtiquetasLegibles(etiquetasX, centros, MAX_ETIQUETAS_X).map(i => (
            <text key={puntos[i].clave} x={centros[i]} y={ALTO_GRAFICA - 8} textAnchor={i === 0 ? 'start' : i === puntos.length - 1 ? 'end' : 'middle'} className="fill-w-texto2" fontSize="11" fontWeight={i === puntos.length - 1 && terminaHoy ? 700 : 400}>{etiquetasX[i]}</text>
          ))}
        </svg>
        {activo && indice !== null && (
          <TooltipGrafica x={centros[indice] * escala} y={y(activo.total) * escala} anchoContenedor={ANCHO_GRAFICA * escala}>
            <p className="font-semibold">{PREFIJO_TRAMO[granularidad]}{activo.etiqueta}</p>
            <p className="tabular-nums">Total {fmt(activo.total)}</p>
            {vista === 'tipo' && SERIES_TIPO.map(s => <p key={s.clave} className="tabular-nums">{s.etiqueta} {fmt(activo[s.clave])}</p>)}
          </TooltipGrafica>
        )}
      </div>
      <AnuncioActivo texto={textoActivo} />
      <TablaAccesible
        titulo={etiquetaAria}
        columnas={['Tramo', 'Total', ...SERIES_TIPO.map(s => s.etiqueta)]}
        filas={puntos.map(p => [p.etiqueta, fmt(p.total), fmt(p.pagos), fmt(p.adelantos), fmt(p.otros)])}
      />
    </figure>
  );
}
