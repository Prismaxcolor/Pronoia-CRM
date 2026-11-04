import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { calcularEjeY, clamp, escalaLineal, indiceMasCercano, posicionesX, resumirSerie, rutaArea, rutaLinea } from '../../../lib/graficas';
import { formatearCompacto, formatearNumero } from '../../../lib/formato';
import { COLOR_EJE, COLOR_GUIA, COLOR_MARCA } from '../../../lib/paleta';
import EstadoVacio from '../EstadoVacio';
import { AnuncioActivo, TablaOculta, TooltipGrafica } from './compartido';
import { useAnchoElemento } from './useAnchoElemento';

/** CUÁNDO USARLA: evolución de UN valor en el tiempo (kg en galpón por día, ventas por semana). Línea con área suave,
 *  ejes mínimos, tooltip por hover/foco/toque y flechas del teclado. Para comparar categorías usa barras; para un
 *  indicador pequeño dentro de una tarjeta usa <Sparkline/>. */
export interface PuntoTiempo {
  /** Texto del punto en el eje y el tooltip ("04/10", "Semana 40"). */
  etiqueta: string;
  valor: number;
}

export interface LineaTiempoProps {
  puntos: ReadonlyArray<PuntoTiempo>;
  formatoValor?: (v: number) => string;
  color?: string;
  alto?: number;
  area?: boolean;
  etiquetaAria: string;
  mensajeVacio?: string;
}

const pad = { arriba: 12, derecha: 12, abajo: 24 };

function LineaTiempo({ puntos, formatoValor = v => formatearNumero(v, 0), color = COLOR_MARCA, alto = 200, area = true, etiquetaAria, mensajeVacio = 'Sin datos para graficar en este periodo.' }: LineaTiempoProps) {
  const [ref, ancho] = useAnchoElemento<HTMLDivElement>();
  const [activo, setActivo] = useState<number | null>(null);
  const valores = useMemo(() => puntos.map(p => p.valor), [puntos]);
  const resumen = useMemo(() => resumirSerie(valores), [valores]);
  const eje = useMemo(() => calcularEjeY(resumen?.min ?? 0, resumen?.max ?? 0, 4), [resumen]);

  if (puntos.length === 0 || !resumen) return <EstadoVacio mensaje={mensajeVacio} />;

  const etiquetasY = eje.ticks.map(formatearCompacto);
  const izq = Math.max(...etiquetasY.map(l => l.length)) * 6.2 + 12;
  const baseY = alto - pad.abajo;
  const y = escalaLineal(eje.min, eje.max, baseY, pad.arriba);
  const xs = posicionesX(puntos.length, izq + 4, ancho - pad.derecha);
  const geom = puntos.map((p, i) => ({ x: xs[i], y: y(p.valor) }));
  // Etiquetas del eje X: primero, último y algunos intermedios sin que se pisen.
  const maxEtiquetas = Math.max(2, Math.floor((ancho - izq) / 70));
  const cadaCuanto = Math.max(1, Math.ceil(puntos.length / maxEtiquetas));
  const ultimo = puntos.length - 1;
  const mostrarX = (i: number) => i === ultimo || (i % cadaCuanto === 0 && ultimo - i >= cadaCuanto * 0.75);

  const desdePuntero = (e: PointerEvent<HTMLDivElement>) => {
    const caja = e.currentTarget.getBoundingClientRect();
    setActivo(indiceMasCercano(xs, e.clientX - caja.left));
  };
  const alTecla = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { setActivo(null); return; }
    const paso = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'Home' ? -Infinity : e.key === 'End' ? Infinity : 0;
    if (!paso) return;
    e.preventDefault();
    setActivo(a => clamp(Number.isFinite(paso) ? (a ?? (paso > 0 ? -1 : puntos.length)) + paso : paso < 0 ? 0 : puntos.length - 1, 0, puntos.length - 1));
  };

  const textoActivo = activo === null ? '' : `${puntos[activo].etiqueta}: ${formatoValor(puntos[activo].valor)}`;
  const resumenTexto = `${etiquetaAria}. De ${puntos[0].etiqueta} a ${puntos[puntos.length - 1].etiqueta}: mínimo ${formatoValor(resumen.min)}, máximo ${formatoValor(resumen.max)}, promedio ${formatoValor(resumen.promedio)}.`;

  return (
    <figure className="m-0">
      <div
        ref={ref}
        role="group"
        tabIndex={0}
        aria-label={`${resumenTexto} Usa las flechas para recorrer los valores.`}
        onPointerMove={desdePuntero}
        onPointerDown={desdePuntero}
        onPointerLeave={e => { if (e.pointerType === 'mouse') setActivo(null); }}
        onBlur={() => setActivo(null)}
        onKeyDown={alTecla}
        className="relative touch-pan-y rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <svg width={ancho} height={alto} aria-hidden="true" className="block">
          {eje.ticks.map((t, i) => (
            <g key={t}>
              <line x1={izq} x2={ancho - pad.derecha} y1={y(t)} y2={y(t)} stroke={t === 0 ? COLOR_EJE : COLOR_GUIA} strokeWidth={1} />
              <text x={izq - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill={COLOR_EJE}>{etiquetasY[i]}</text>
            </g>
          ))}
          {area && puntos.length > 1 && <path d={rutaArea(geom, baseY)} style={{ fill: color }} opacity={0.12} />}
          {puntos.length > 1
            ? <path d={rutaLinea(geom)} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: color }} />
            : null}
          {puntos.length <= 24 && geom.map((g, i) => <circle key={i} cx={g.x} cy={g.y} r={activo === i ? 5 : 2.5} style={{ fill: color }} stroke="#fff" strokeWidth={activo === i ? 2 : 0} />)}
          {activo !== null && <line x1={geom[activo].x} x2={geom[activo].x} y1={pad.arriba} y2={baseY} stroke={COLOR_EJE} strokeDasharray="3 3" strokeWidth={1} />}
          {puntos.map((p, i) => mostrarX(i) && (
            <text key={i} x={xs[i]} y={alto - 8} textAnchor={i === 0 ? 'start' : i === puntos.length - 1 ? 'end' : 'middle'} fontSize={10} fill={COLOR_EJE}>{p.etiqueta}</text>
          ))}
        </svg>
        {activo !== null && (
          <TooltipGrafica x={geom[activo].x} y={geom[activo].y} anchoContenedor={ancho}>
            <p className="font-semibold">{puntos[activo].etiqueta}</p>
            <p className="tabular-nums">{formatoValor(puntos[activo].valor)}</p>
          </TooltipGrafica>
        )}
      </div>
      <AnuncioActivo texto={textoActivo} />
      <TablaOculta titulo={etiquetaAria} encabezados={['Punto', 'Valor']} filas={puntos.map(p => [p.etiqueta, formatoValor(p.valor)])} />
    </figure>
  );
}

export interface SparklineProps {
  valores: ReadonlyArray<number>;
  color?: string;
  alto?: number;
  /** Resumen accesible ("Kg en galpón, últimos 14 días: de 800 a 1.200 kg"). */
  etiquetaAria: string;
  area?: boolean;
}

/** CUÁNDO USARLA: tendencia mínima dentro de una tarjeta KPI o fila (sin ejes ni tooltip). Escala al ancho de su
 *  contenedor. Acompáñala siempre con la cifra actual en texto. */
export function Sparkline({ valores, color = COLOR_MARCA, alto = 32, etiquetaAria, area = true }: SparklineProps) {
  const r = resumirSerie(valores);
  if (!r || valores.length < 2) return null;
  const rango = r.max - r.min || 1;
  const xs = posicionesX(valores.length, 1, 99);
  const pts = valores.map((v, i) => ({ x: xs[i], y: 3 + (1 - (v - r.min) / rango) * (alto - 6) }));
  return (
    <svg viewBox={`0 0 100 ${alto}`} preserveAspectRatio="none" width="100%" height={alto} role="img" aria-label={etiquetaAria} className="block">
      {area && <path d={rutaArea(pts, alto)} style={{ fill: color }} opacity={0.12} />}
      <path d={rutaLinea(pts)} fill="none" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" style={{ stroke: color }} />
    </svg>
  );
}

export default LineaTiempo;
