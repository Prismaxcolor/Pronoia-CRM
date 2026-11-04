/** Diagrama simple entrada -> salidas -> merma de UNA transformación (SVG propio, sin librerías). El alto de cada caja y
 *  el grosor de cada cinta son proporcionales a los kg. En pantallas angostas el SVG se reemplaza por una lista con barras
 *  (el texto pequeño de un SVG escalado no se lee) y la lista queda siempre disponible para lectores de pantalla.
 *  La geometría sale de lib/transformaciones-kpis.ts (construirDiagramaFlujo, probada). */

import { useMemo } from 'react';
import { formatearNumero, formatearPct } from '../../components/ui';
import { kgFino } from './transformaciones-comun';
import { COLOR_MARCA } from '../../lib/paleta';
import { construirDiagramaFlujo, type EntradaDiagrama } from '../../lib/transformaciones-kpis';

export interface DiagramaFlujoTransformacionProps {
  entrada: EntradaDiagrama['entrada'];
  salidas: EntradaDiagrama['salidas'];
  mermaKg: number;
}

const ANCHO_FLUJO = 420;
const ALTO_MAX_FLUJO = 220;
const MARGEN_IZQ = 150;
const MARGEN_DER = 190;
const MAX_CARACTERES = 26;
const COLOR_MERMA = '#8A8F98';
/** Separación vertical mínima entre rótulos de la columna derecha (cada rótulo ocupa dos líneas). */
const SEPARACION_ROTULOS = 30;

const recortar = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);
const pctDeEntrada = (kg: number, entrada: number) => (entrada > 0 ? (kg / entrada) * 100 : 0);

function DiagramaFlujoTransformacion({ entrada, salidas, mermaKg }: DiagramaFlujoTransformacionProps) {
  const diagrama = useMemo(() => construirDiagramaFlujo({ entrada, salidas, mermaKg }, ANCHO_FLUJO, ALTO_MAX_FLUJO), [entrada, salidas, mermaKg]);
  if (!diagrama) return null;

  const filas = diagrama.nodos.filter(n => n.tipo !== 'entrada');
  const resumen = `De ${kgFino(entrada.kg)} que entraron: ${filas.map(n => `${n.etiqueta} ${kgFino(n.kg)} (${formatearPct(pctDeEntrada(n.kg, entrada.kg), 1)})`).join('; ')}.`;
  const anchoTotal = MARGEN_IZQ + diagrama.ancho + MARGEN_DER;
  // Los rótulos se reparten hacia abajo para que no se pisen cuando hay muchas salidas pequeñas.
  const yRotulo = new Map<string, number>();
  let ultimoY = -Infinity;
  for (const n of filas) {
    const y = Math.max(n.y + n.alto / 2, ultimoY + SEPARACION_ROTULOS);
    yRotulo.set(n.id, y);
    ultimoY = y;
  }
  const altoSvg = Math.max(diagrama.alto, ultimoY + 20);
  const colorNodo = (tipo: string) => (tipo === 'merma' ? COLOR_MERMA : COLOR_MARCA);

  return (
    <figure className="m-0">
      <svg
        viewBox={`${-MARGEN_IZQ} -8 ${anchoTotal} ${altoSvg + 16}`}
        role="img"
        aria-label={resumen}
        className="mx-auto hidden w-full max-w-3xl sm:block"
      >
        <defs>
          <pattern id="trama-merma" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#E5E7EB" />
            <line x1="0" y1="0" x2="0" y2="6" stroke={COLOR_MERMA} strokeWidth="2.5" />
          </pattern>
        </defs>
        {diagrama.enlaces.map(e => (
          <path key={e.destino} d={e.ruta} fill={e.destino === 'merma' ? 'url(#trama-merma)' : COLOR_MARCA} fillOpacity={e.destino === 'merma' ? 1 : 0.28}>
            <title>{`${entrada.etiqueta} → ${e.destino === 'merma' ? 'Merma' : filas.find(n => n.id === e.destino)?.etiqueta}: ${kgFino(e.kg)}`}</title>
          </path>
        ))}
        {diagrama.nodos.map(n => (
          <g key={n.id}>
            <rect x={n.x} y={n.y} width={n.ancho} height={n.alto} rx={2} fill={n.tipo === 'merma' ? 'url(#trama-merma)' : colorNodo(n.tipo)} stroke={n.tipo === 'merma' ? COLOR_MERMA : 'none'} strokeWidth={1}>
              <title>{`${n.etiqueta}: ${kgFino(n.kg)}`}</title>
            </rect>
            {n.tipo === 'entrada' ? (
              <text x={n.x - 8} y={n.y + n.alto / 2} textAnchor="end" fontSize={12} className="fill-text-primary">
                <tspan x={n.x - 8} dy="-0.2em" fontWeight={600}>{recortar(n.etiqueta, 21)}</tspan>
                <tspan x={n.x - 8} dy="1.3em" className="fill-text-secondary">{kgFino(n.kg)}</tspan>
              </text>
            ) : (
              <text x={n.x + n.ancho + 8} y={yRotulo.get(n.id) ?? n.y} fontSize={12} className="fill-text-primary">
                <tspan x={n.x + n.ancho + 8} dy="-0.2em" fontWeight={600}>{recortar(n.etiqueta, MAX_CARACTERES)}</tspan>
                <tspan x={n.x + n.ancho + 8} dy="1.3em" className="fill-text-secondary">{kgFino(n.kg)} · {formatearPct(pctDeEntrada(n.kg, entrada.kg), 1)}</tspan>
              </text>
            )}
          </g>
        ))}
      </svg>

      <ul aria-label="Reparto de la entrada" className="space-y-2 sm:sr-only">
        <li className="flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 truncate font-medium text-text-primary">Entrada: {entrada.etiqueta}</span>
          <span className="shrink-0 font-semibold tabular-nums text-text-primary">{kgFino(entrada.kg)}</span>
        </li>
        {filas.map(n => {
          const pct = Math.min(100, Math.max(0, pctDeEntrada(n.kg, entrada.kg)));
          return (
            <li key={n.id} className="text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-text-primary">→ {n.etiqueta}</span>
                <span className="shrink-0 tabular-nums text-text-primary">{kgFino(n.kg)} <span className="text-xs text-text-secondary">({formatearNumero(pct, 1)} %)</span></span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-hover" aria-hidden="true">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: n.tipo === 'merma' ? 'repeating-linear-gradient(45deg,#8A8F98 0 3px,#E5E7EB 3px 6px)' : COLOR_MARCA }} />
              </div>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

export default DiagramaFlujoTransformacion;
