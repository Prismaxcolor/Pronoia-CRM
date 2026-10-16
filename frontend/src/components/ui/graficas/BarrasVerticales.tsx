import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { apilarCategoria, calcularEjeY, clamp, escalaLineal, geometriaBarras } from '../../../lib/graficas';
import { formatearCompacto, formatearNumero } from '../../../lib/formato';
import { COLOR_EJE, COLOR_GUIA, colorDeSerie } from '../../../lib/paleta';
import EstadoVacio from '../EstadoVacio';
import { AnuncioActivo, LeyendaGrafica, TablaOculta, TooltipGrafica } from './compartido';
import { useAnchoElemento } from './useAnchoElemento';

/** CUÁNDO USARLA: comparar valores entre categorías ordenadas en el tiempo o en el espacio (kg por semana, ventas por
 *  mes). Una serie = barras simples; varias series con `apilada` = partes de un total por categoría; varias sin `apilada`
 *  = barras agrupadas. Para pocas categorías con nombres largos usa BarrasHorizontales; para tendencia continua, LineaTiempo.
 *  Ejes mínimos (líneas guía suaves y valores abreviados), tooltip por hover/foco/toque, flechas del teclado, leyenda en texto. */
export interface SerieBarras {
  etiqueta: string;
  valores: ReadonlyArray<number>;
  /** Color propio (por defecto el de la paleta de series: la primera es la marca). */
  color?: string;
}

export interface BarrasVerticalesProps {
  categorias: ReadonlyArray<string>;
  series: ReadonlyArray<SerieBarras>;
  apilada?: boolean;
  /** Formato del valor en tooltip y resumen (incluye la unidad: formatearKg, formatearUsd...). */
  formatoValor?: (v: number) => string;
  alto?: number;
  /** Texto accesible que dice qué muestra la gráfica. */
  etiquetaAria: string;
  /** Mensaje cuando no hay datos. */
  mensajeVacio?: string;
}

const pad = { arriba: 10, derecha: 6, abajo: 24 };

function BarrasVerticales({ categorias, series, apilada = false, formatoValor = v => formatearNumero(v, 0), alto = 220, etiquetaAria, mensajeVacio = 'Sin datos para graficar en este periodo.' }: BarrasVerticalesProps) {
  const [ref, ancho] = useAnchoElemento<HTMLDivElement>();
  const [activo, setActivo] = useState<number | null>(null);
  const colores = series.map((s, i) => s.color ?? colorDeSerie(i));
  const hayDatos = categorias.length > 0 && series.some(s => s.valores.some(v => Number.isFinite(v) && v > 0));

  const modelo = useMemo(() => {
    const porCategoria = categorias.map((_, i) => series.map(s => s.valores[i] ?? 0));
    const tope = apilada ? Math.max(0, ...porCategoria.map(v => apilarCategoria(v).total)) : Math.max(0, ...porCategoria.flat().filter(Number.isFinite));
    const eje = calcularEjeY(0, tope, 4);
    return { porCategoria, eje, etiquetasY: eje.ticks.map(formatearCompacto) };
  }, [categorias, series, apilada]);

  if (!hayDatos) return <EstadoVacio mensaje={mensajeVacio} />;

  const izq = Math.max(...modelo.etiquetasY.map(l => l.length)) * 6.2 + 12;
  const areaAncho = Math.max(40, ancho - izq - pad.derecha);
  const baseY = alto - pad.abajo;
  const y = escalaLineal(modelo.eje.min, modelo.eje.max, baseY, pad.arriba);
  const geo = geometriaBarras(categorias.length, areaAncho, 0.3);
  const agrupada = !apilada && series.length > 1;
  const anchoLabel = Math.max(...categorias.map(c => c.length)) * 6 + 8;
  const cadaCuanto = Math.max(1, Math.ceil(anchoLabel / geo.paso));

  const desdePuntero = (e: PointerEvent<HTMLDivElement>) => {
    const caja = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - caja.left - izq) / geo.paso);
    setActivo(i >= 0 && i < categorias.length ? i : null);
  };
  const alTecla = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { setActivo(null); return; }
    const paso = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!paso) return;
    e.preventDefault();
    setActivo(a => clamp((a ?? (paso > 0 ? -1 : categorias.length)) + paso, 0, categorias.length - 1));
  };

  const textoActivo = activo === null ? '' : `${categorias[activo]}: ${series.map((s, k) => `${s.etiqueta} ${formatoValor(modelo.porCategoria[activo][k])}`).join(', ')}`;
  const xCentro = (i: number) => izq + geo.xs[i] + geo.ancho / 2;
  const yTope = (i: number) => {
    const v = apilada ? apilarCategoria(modelo.porCategoria[i]).total : Math.max(...modelo.porCategoria[i]);
    return y(v);
  };

  return (
    <figure className="m-0">
      <div
        ref={ref}
        role="group"
        tabIndex={0}
        aria-label={`${etiquetaAria}. Usa las flechas izquierda y derecha para recorrer los valores.`}
        onPointerMove={desdePuntero}
        onPointerDown={desdePuntero}
        onPointerLeave={e => { if (e.pointerType === 'mouse') setActivo(null); }}
        onBlur={() => setActivo(null)}
        onKeyDown={alTecla}
        className="relative touch-pan-y rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <svg width={ancho} height={alto} aria-hidden="true" className="block">
          {modelo.eje.ticks.map((t, i) => (
            <g key={t}>
              <line x1={izq} x2={ancho - pad.derecha} y1={y(t)} y2={y(t)} stroke={t === 0 ? COLOR_EJE : COLOR_GUIA} strokeWidth={1} />
              <text x={izq - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill={COLOR_EJE}>{modelo.etiquetasY[i]}</text>
            </g>
          ))}
          {categorias.map((c, i) => {
            const resaltada = activo === i;
            const x0 = izq + geo.xs[i];
            const subAncho = agrupada ? geo.ancho / series.length : geo.ancho;
            const apil = apilada ? apilarCategoria(modelo.porCategoria[i]).segmentos : [];
            return (
              <g key={`${i}-${c}`} opacity={activo === null || resaltada ? 1 : 0.55}>
                {resaltada && <rect x={izq + i * geo.paso} y={pad.arriba} width={geo.paso} height={baseY - pad.arriba} fill="rgba(0,0,0,0.04)" />}
                {apilada
                  ? apil.filter(s => s.valor > 0).map(s => (
                    <rect key={s.indiceSerie} x={x0} y={y(s.hasta)} width={geo.ancho} height={Math.max(1, y(s.desde) - y(s.hasta))} style={{ fill: colores[s.indiceSerie] }} />
                  ))
                  : series.map((_, k) => {
                    const v = modelo.porCategoria[i][k];
                    if (!(v > 0)) return null;
                    return <rect key={k} x={x0 + (agrupada ? k * subAncho : 0)} y={y(v)} width={Math.max(1, subAncho - (agrupada ? 1 : 0))} height={Math.max(1, baseY - y(v))} rx={2} style={{ fill: colores[k] }} />;
                  })}
                {i % cadaCuanto === 0 && <text x={xCentro(i)} y={alto - 8} textAnchor="middle" fontSize={10} fill={COLOR_EJE}>{c}</text>}
              </g>
            );
          })}
        </svg>
        {activo !== null && (
          <TooltipGrafica x={xCentro(activo)} y={yTope(activo)} anchoContenedor={ancho}>
            <p className="font-semibold">{categorias[activo]}</p>
            {series.map((s, k) => (
              <p key={s.etiqueta} className="flex items-center justify-between gap-2 tabular-nums">
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: colores[k] }} />{series.length > 1 ? s.etiqueta : 'Valor'}</span>
                <span className="font-medium">{formatoValor(modelo.porCategoria[activo][k])}</span>
              </p>
            ))}
          </TooltipGrafica>
        )}
      </div>
      {series.length > 1 && <LeyendaGrafica items={series.map((s, i) => ({ etiqueta: s.etiqueta, color: colores[i] }))} />}
      <AnuncioActivo texto={textoActivo} />
      <TablaOculta
        titulo={etiquetaAria}
        encabezados={['Categoría', ...series.map(s => s.etiqueta)]}
        filas={categorias.map((c, i) => [c, ...series.map((_, k) => formatoValor(modelo.porCategoria[i][k]))])}
      />
    </figure>
  );
}

export default BarrasVerticales;
