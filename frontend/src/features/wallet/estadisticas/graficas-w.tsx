import { useMemo, type ReactNode } from 'react';
import { AnuncioActivo, TooltipGrafica } from '../../../components/ui/graficas/compartido';
import { angulosDona, calcularEjeY, escalaLineal, geometriaBarras, rutaArco, rutaAreaMonotona, rutaCurvaMonotona } from '../../../lib/graficas';
import { formatearCompacto, formatearPct } from '../../../lib/formato';
import { etiquetasEjeX, indicesEtiquetasLegibles } from './estadisticas-curvas';
import { MAX_PORCIONES_DONA_W, porcionesDonaW, type ItemDonaW } from './estadisticas-dona';
import type { Granularidad, PuntoFlujo } from './estadisticas-logica';
import { TablaAccesible } from './elementos';
import { ALTO_GRAFICA, ANCHO_GRAFICA, MARGEN_GRAFICA, MAX_ETIQUETAS_X, PREFIJO_TRAMO, margenIzquierdo } from './graficas-estilos';
import { useCursorGrafica } from './useCursorGrafica';

/** Gráficas SVG propias de Estadísticas. Colores por tokens w-* (fill-/stroke-); el texto de cada barra va en el tooltip
 *  (ratón, toque y flechas del teclado), en una región aria-live y en una tabla solo para lectores de pantalla.
 *  Sin montos en los ejes cuando se ocultan las cantidades. */

export type ModoFlujo = 'tendencia' | 'acumulado';

interface PropsFlujo {
  puntos: readonly PuntoFlujo[];
  modo: ModoFlujo;
  granularidad: Granularidad;
  /** El rango termina hoy: el último tramo se rotula "Hoy". */
  terminaHoy: boolean;
  ocultar: boolean;
  fmt: (monto: number) => string;
  etiquetaAria: string;
}

function textoPunto(p: PuntoFlujo, g: Granularidad, fmt: (m: number) => string): string {
  return `${PREFIJO_TRAMO[g]}${p.etiqueta}: ingresos ${fmt(p.ingresos)}, gastos ${fmt(p.egresos)}, flujo ${fmt(p.neto)}, acumulado ${fmt(p.acumulado)}`;
}

function GraficaFlujo({ puntos, modo, granularidad, terminaHoy, ocultar, fmt, etiquetaAria }: PropsFlujo) {
  const izq = margenIzquierdo(ocultar);
  const { arriba, abajo, derecha } = MARGEN_GRAFICA;
  const geo = useMemo(() => {
    const topes = modo === 'tendencia'
      ? [...puntos.map(p => p.ingresos), ...puntos.map(p => -p.egresos), ...puntos.map(p => p.neto)]
      : puntos.map(p => p.acumulado);
    const eje = calcularEjeY(Math.min(...topes), Math.max(...topes), 4);
    const y = escalaLineal(eje.max, eje.min, arriba, ALTO_GRAFICA - abajo);
    const barras = geometriaBarras(puntos.length, ANCHO_GRAFICA - izq - derecha, 0.35);
    return { eje, y, barras, centros: barras.xs.map(x => izq + x + barras.ancho / 2) };
  }, [puntos, modo, izq, arriba, abajo, derecha]);
  const { eje, y, barras, centros } = geo;
  const { ref: refGrafica, escala, indice, manejadores } = useCursorGrafica(centros, ANCHO_GRAFICA);
  const linea = puntos.map((p, i) => ({ x: centros[i], y: y(modo === 'tendencia' ? p.neto : p.acumulado) }));
  const etiquetasX = etiquetasEjeX(puntos.map(p => p.etiqueta), granularidad, terminaHoy);
  const activo = indice === null ? null : puntos[indice];
  const texto = activo ? textoPunto(activo, granularidad, fmt) : '';

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
          {modo === 'tendencia' && puntos.map((p, i) => (
            <g key={p.clave}>
              <rect x={izq + barras.xs[i]} width={barras.ancho} y={arriba} height={ALTO_GRAFICA - abajo - arriba} rx={3} className={indice === i ? 'fill-w-borde' : 'fill-w-grupo'} />
              <rect x={izq + barras.xs[i]} width={barras.ancho} y={y(p.ingresos)} height={Math.max(0, y(0) - y(p.ingresos))} className="fill-w-positivo" />
              <rect x={izq + barras.xs[i]} width={barras.ancho} y={y(0)} height={Math.max(0, y(-p.egresos) - y(0))} className="fill-w-negativo" />
            </g>
          ))}
          {modo === 'acumulado' && <path d={rutaAreaMonotona(linea, y(0))} className="fill-w-acento" opacity={0.18} />}
          {linea.length > 1 && <path d={rutaCurvaMonotona(linea)} fill="none" className="stroke-w-acento" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
          {linea.length === 1 && <circle cx={linea[0].x} cy={linea[0].y} r={3} className="fill-w-acento" />}
          {indice !== null && <line x1={centros[indice]} x2={centros[indice]} y1={arriba} y2={ALTO_GRAFICA - abajo} className="stroke-w-texto2" strokeDasharray="3 3" strokeWidth={1} />}
          {indice !== null && <circle cx={linea[indice].x} cy={linea[indice].y} r={4.5} className="fill-w-acento stroke-w-tarjeta" strokeWidth={2} />}
          {indicesEtiquetasLegibles(etiquetasX, centros, MAX_ETIQUETAS_X).map(i => (
            <text key={puntos[i].clave} x={centros[i]} y={ALTO_GRAFICA - 8} textAnchor={i === 0 ? 'start' : i === puntos.length - 1 ? 'end' : 'middle'} className="fill-w-texto2" fontSize="11" fontWeight={i === puntos.length - 1 && terminaHoy ? 700 : 400}>{etiquetasX[i]}</text>
          ))}
        </svg>
        {activo && indice !== null && (
          <TooltipGrafica x={centros[indice] * escala} y={linea[indice].y * escala} anchoContenedor={ANCHO_GRAFICA * escala}>
            <p className="font-semibold">{PREFIJO_TRAMO[granularidad]}{activo.etiqueta}</p>
            <p className="tabular-nums text-w-positivo">Ingresos {fmt(activo.ingresos)}</p>
            <p className="tabular-nums text-w-negativo">Gastos {fmt(activo.egresos)}</p>
            <p className="tabular-nums">Flujo {fmt(activo.neto)}</p>
            {modo === 'acumulado' && <p className="tabular-nums">Acumulado {fmt(activo.acumulado)}</p>}
          </TooltipGrafica>
        )}
      </div>
      <AnuncioActivo texto={texto} />
      <TablaAccesible
        titulo={etiquetaAria}
        columnas={['Tramo', 'Ingresos', 'Gastos', 'Flujo', 'Acumulado']}
        filas={puntos.map(p => [p.etiqueta, fmt(p.ingresos), fmt(p.egresos), fmt(p.neto), fmt(p.acumulado)])}
      />
    </figure>
  );
}

interface PropsDona {
  items: readonly ItemDonaW[];
  /** Contenido del centro del anillo. */
  centro: ReactNode;
  /** Monto de una porción; `oculto` = pertenece a una cuenta con el ojo cerrado (debe enmascararse). */
  fmt: (monto: number, oculto: boolean) => string;
  etiquetaAria: string;
  /** Máximo de porciones antes de agrupar el resto en "Otros" (hasta 8). */
  max?: number;
}

/** Dona con leyenda de texto (nombre, monto y %): el color solo identifica, nunca informa solo. Los colores que se
 *  parecen entre sí se separan y "Otros" usa un neutro propio. */
function DonaW({ items, centro, fmt, etiquetaAria, max = MAX_PORCIONES_DONA_W }: PropsDona) {
  const porciones = useMemo(() => porcionesDonaW(items, max), [items, max]);
  const angulos = useMemo(() => angulosDona(porciones), [porciones]);
  return (
    <figure className="m-0 flex flex-col items-center gap-4 sm:flex-row" aria-label={etiquetaAria}>
      <div className="relative h-44 w-44 shrink-0">
        <svg viewBox="0 0 120 120" className="block h-full w-full" aria-hidden="true">
          {porciones.map((p, i) => (
            <path key={`${i}-${p.etiqueta}`} d={rutaArco(60, 60, 56, 38, angulos[i][0], angulos[i][1])} fillRule="evenodd" style={{ fill: p.color }} className="stroke-w-tarjeta" strokeWidth={porciones.length > 1 ? 1.5 : 0} />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">{centro}</div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-1.5 text-sm" aria-label="Detalle">
        {porciones.map((p, i) => (
          <li key={`${i}-${p.etiqueta}`} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: p.color }} />
              <span className="truncate">{p.etiqueta}</span>
            </span>
            <span className="shrink-0 tabular-nums">{fmt(p.valor, p.oculto)} <span className="text-w-texto2">· {formatearPct(p.pct, 1)}</span></span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export { GraficaFlujo, DonaW };
