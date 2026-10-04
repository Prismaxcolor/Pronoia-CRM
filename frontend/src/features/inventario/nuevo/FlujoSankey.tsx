/** Diagrama de flujo de kilos (Fase 3): compra -> categoría -> lote de trabajo -> lote de exportación / venta directa / merma.
 *  SVG propio (lib/sankey-layout), sin librerías. Pide GET /api/inventario/pantalla/flujo SIN `categoria` (el diagrama se queda
 *  completo y solo resalta la categoría elegida). Clic en un nodo o franja filtra la pantalla (?categoria=); hover y teclado
 *  muestran los kg. En móvil se reemplaza por una lista. Donde el backend marca `tramosSinDatos` se avisa y no se inventa nada.
 *  Se carga con React.lazy: export default. */

import { useMemo, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Info, List, Workflow } from 'lucide-react';
import type { FlujoPantalla } from '@shared/types/inventario-pantalla.js';
import { formatearKg, type FiltrosPantalla } from '../../../lib/inventario-nuevo';
import { claveParametros, parametrosPantalla } from '../../../lib/inventario-pantalla';
import { agruparClasificaciones, calcularLayoutSankey, listaFlujoMovil, listaLotesMovil, type EnlacePosicionado, type LayoutSankey, type NodoPosicionado } from '../../../lib/sankey-layout';
import { obtenerFlujoPantalla } from '../../../services/inventario-pantalla-service';
import type { ResumenInventario } from '../../../services/inventario-resumen-service';
import Bloque from './Bloque';
import { AvisosMeta, ChipFiltro, ErrorBloque, SkeletonBloque } from './PantallaComun';
import { useCambiarFiltros, useDatosPantalla } from './useDatosPantalla';

export interface FlujoSankeyProps {
  /** Filtros vigentes de la pantalla (ya validados; vienen de la URL). */
  filtros: FiltrosPantalla;
  /** Resumen cargado (GET /api/inventario/resumen). No se usa: este bloque pide sus propios datos. */
  resumen: ResumenInventario | null;
}

const ANCHO = 960;
const MARGEN_IZQ = 120;
const MARGEN_DER = 175;
const ALTO_ENCABEZADO = 26;
const ALTO_POR_NODO = 30;
const ALTO_MINIMO = 300;
/** Alto mínimo de un nodo pequeño: con la separación de 14 px deja 26 px por nodo, lo que mide una etiqueta de dos líneas. */
const ALTO_MINIMO_NODO = 12;
/** Las etiquetas de columnas intermedias solo tienen ~150 px antes de la columna siguiente; las de la última pueden ser más largas. */
const MAX_CARACTERES_ETIQUETA = 22;
const MAX_CARACTERES_ETIQUETA_FINAL = 28;

const recortar = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

interface Tooltip { x: number; y: number; titulo: string; kg: number; extra?: string }

function mensajeEnlace(l: EnlacePosicionado, nombres: Map<string, string>): Tooltip['titulo'] {
  return `${nombres.get(l.origen) ?? l.origen} → ${nombres.get(l.destino) ?? l.destino}`;
}

function Diagrama({ layout, categoria, onFiltrar }: { layout: LayoutSankey; categoria: string | undefined; onFiltrar: (c: string | null) => void }) {
  const [tip, setTip] = useState<Tooltip | null>(null);
  const nombres = useMemo(() => new Map(layout.nodos.map(n => [n.id, n.nombre])), [layout]);
  const resaltando = Boolean(categoria);
  const nodoActivo = (n: NodoPosicionado) => !resaltando || n.filtroCategoria === categoria;
  const enlaceActivo = (l: EnlacePosicionado) => !resaltando || l.filtroCategoria === categoria;

  const filtrarNodo = (n: NodoPosicionado) => { if (n.filtroCategoria) onFiltrar(n.filtroCategoria === categoria ? null : n.filtroCategoria); };
  const filtrarEnlace = (l: EnlacePosicionado) => { if (l.filtroCategoria) onFiltrar(l.filtroCategoria === categoria ? null : l.filtroCategoria); };
  const tecla = (e: KeyboardEvent<SVGGElement>, accion: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); accion(); }
  };

  const verNodo = (n: NodoPosicionado) => setTip({ x: n.x + MARGEN_IZQ + n.ancho / 2, y: ALTO_ENCABEZADO + n.y, titulo: n.nombre, kg: n.kg, extra: n.filtroCategoria ? 'Clic para filtrar la pantalla' : undefined });

  return (
    <svg viewBox={`0 0 ${ANCHO} ${layout.alto + ALTO_ENCABEZADO}`} className="hidden h-auto w-full md:block" role="group" aria-label="Diagrama de flujo de kilos" onMouseLeave={() => setTip(null)}>
      {layout.columnas.map((c, i) => (
        <text key={c.columna} x={MARGEN_IZQ + c.x + c.ancho / 2} y={14} textAnchor={i === 0 ? 'start' : i === layout.columnas.length - 1 ? 'end' : 'middle'} className="fill-text-secondary text-[11px] font-medium">
          {c.etiqueta}
        </text>
      ))}
      <g transform={`translate(${MARGEN_IZQ},${ALTO_ENCABEZADO})`}>
        <g>
          {layout.enlaces.map(l => (
            <path
              key={`${l.origen}>${l.destino}`}
              d={l.ruta}
              fill={l.color}
              fillOpacity={enlaceActivo(l) ? 0.38 : 0.1}
              className={`transition-[fill-opacity] hover:[fill-opacity:0.65] ${l.filtroCategoria ? 'cursor-pointer' : ''}`}
              onClick={() => filtrarEnlace(l)}
              onMouseMove={e => {
                const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                const k = ANCHO / r.width;
                setTip({ x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, titulo: mensajeEnlace(l, nombres), kg: l.kg });
              }}
            />
          ))}
        </g>
        {layout.nodos.map(n => {
          const alIzquierda = n.indiceColumna === 0;
          const lx = alIzquierda ? -8 : n.ancho + 8;
          const esUltima = n.indiceColumna === layout.columnas.length - 1;
          const yEtiqueta = Math.min(n.alto / 2, 13) + n.etiquetaDy;
          const clicable = Boolean(n.filtroCategoria);
          return (
            <g
              key={n.id}
              tabIndex={0}
              role={clicable ? 'button' : 'img'}
              aria-label={`${n.nombre}: ${formatearKg(n.kg)}${clicable ? '. Enter para filtrar la pantalla' : ''}`}
              aria-pressed={clicable ? n.filtroCategoria === categoria : undefined}
              opacity={nodoActivo(n) ? 1 : 0.35}
              className={`outline-none focus-visible:[&>rect]:stroke-brand-700 focus-visible:[&>rect]:stroke-[3] ${clicable ? 'cursor-pointer' : ''}`}
              transform={`translate(${n.x},${n.y})`}
              onClick={() => filtrarNodo(n)}
              onKeyDown={e => tecla(e, () => filtrarNodo(n))}
              onMouseEnter={() => verNodo(n)}
              onFocus={() => verNodo(n)}
              onBlur={() => setTip(null)}
            >
              <rect width={n.ancho} height={n.alto} rx={2} fill={n.color} stroke="#fff" strokeWidth={1} />
              <text x={lx} y={yEtiqueta - 1} textAnchor={alIzquierda ? 'end' : 'start'} className="fill-text-primary text-[11px] font-semibold" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}>
                {recortar(n.nombre, esUltima ? MAX_CARACTERES_ETIQUETA_FINAL : MAX_CARACTERES_ETIQUETA)}
              </text>
              <text x={lx} y={yEtiqueta + 12} textAnchor={alIzquierda ? 'end' : 'start'} className="fill-text-secondary text-[10px]" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}>
                {formatearKg(n.kg)}
              </text>
            </g>
          );
        })}
        {tip && (() => {
          const w = Math.max(150, tip.titulo.length * 6.2 + 20);
          const x = Math.min(Math.max(tip.x + 12, 0), ANCHO - MARGEN_IZQ - w);
          const y = Math.max(tip.y - 52, 0);
          return (
            <g pointerEvents="none" role="presentation">
              <rect x={x} y={y} width={w} height={tip.extra ? 54 : 40} rx={6} fill="#111" fillOpacity={0.92} />
              <text x={x + 10} y={y + 17} className="fill-white text-[11px] font-semibold">{tip.titulo}</text>
              <text x={x + 10} y={y + 32} className="fill-white text-[11px]">{formatearKg(tip.kg)}</text>
              {tip.extra && <text x={x + 10} y={y + 47} className="text-[10px]" fill="#AADDBF">{tip.extra}</text>}
            </g>
          );
        })()}
      </g>
    </svg>
  );
}

function ListaFlujo({ flujo, visibleEnEscritorio }: { flujo: FlujoPantalla; visibleEnEscritorio: boolean }) {
  const filas = useMemo(() => listaFlujoMovil(flujo), [flujo]);
  const lotes = useMemo(() => listaLotesMovil(flujo), [flujo]);
  return (
    <div className={visibleEnEscritorio ? '' : 'md:hidden'}>
      {lotes.length > 0 && (
        <>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Lotes: de dónde llegan y a dónde van</h3>
          <ul className="mb-4 space-y-2">
            {lotes.map(l => (
              <li key={l.nombre} className="rounded-lg border border-border bg-surface p-3">
                <p className="flex items-center justify-between gap-2 text-sm font-semibold text-text-primary">
                  <span className="flex items-center gap-2"><span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: l.color }} />{l.nombre}</span>
                  <span className="whitespace-nowrap text-xs font-normal tabular-nums text-text-secondary">entran {formatearKg(l.entraKg)}</span>
                </p>
                <ul className="mt-1.5 space-y-0.5 text-xs text-text-secondary">
                  {l.origenes.map(o => (
                    <li key={`de-${o.nombre}`} className="flex justify-between gap-2"><span>← {o.nombre}</span><span className="whitespace-nowrap font-medium tabular-nums text-text-primary">{formatearKg(o.kg)}</span></li>
                  ))}
                  {l.destinos.map(d => (
                    <li key={`a-${d.nombre}`} className="flex justify-between gap-2"><span>→ {d.nombre}</span><span className="whitespace-nowrap font-medium tabular-nums text-text-primary">{formatearKg(d.kg)}</span></li>
                  ))}
                </ul>
                {l.destinos.length === 0 && <p className="mt-1.5 text-xs text-text-muted">Sin salidas registradas en el período.</p>}
              </li>
            ))}
          </ul>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Categorías: a dónde van</h3>
        </>
      )}
      {filas.length === 0 ? (
        <p className="text-sm text-text-secondary">No hay categorías con movimiento para listar.</p>
      ) : (
        <ul className="space-y-2">
          {filas.map(f => (
            <li key={f.categoria} className="rounded-lg border border-border bg-surface p-3">
              <p className="flex items-center justify-between gap-2 text-sm font-semibold text-text-primary">
                <span className="flex items-center gap-2"><span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: f.color }} />{f.categoria}</span>
                <span className="text-xs font-normal tabular-nums text-text-secondary">entran {formatearKg(f.entraKg)}</span>
              </p>
              {f.destinos.length > 0 ? (
                <ul className="mt-1.5 space-y-0.5 text-xs text-text-secondary">
                  {f.destinos.map(d => (
                    <li key={d.nombre} className="flex justify-between gap-2"><span>→ {d.nombre}</span><span className="whitespace-nowrap font-medium tabular-nums text-text-primary">{formatearKg(d.kg)}</span></li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-xs text-text-muted">Sin salidas registradas: el flujo termina aquí.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EstadoSinDatos({ mensaje }: { mensaje: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border-strong bg-surface px-4 py-8 text-center">
      <p className="text-sm text-text-primary">{mensaje}</p>
      <Link to="/transformaciones" className="mt-2 inline-block text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Registrar transformación →</Link>
    </div>
  );
}

/** Debe coincidir con MOTIVO_DESPRECIABLE del backend (utils/flujo-inventario.ts); shared solo lleva tipos. */
const MOTIVO_DESPRECIABLE = 'menor a 0,5 kg';

function Notas({ flujo }: { flujo: FlujoPantalla }) {
  // Los tramos menores a 0,5 kg no se dibujan por ser ruido: se resumen aparte de los de datos incoherentes.
  const despreciables = flujo.enlacesOmitidos.filter(e => e.motivo === MOTIVO_DESPRECIABLE);
  const incoherentes = flujo.enlacesOmitidos.filter(e => e.motivo !== MOTIVO_DESPRECIABLE);
  const despreciablesKg = despreciables.reduce((a, e) => a + e.kg, 0);
  const omitidosKg = incoherentes.reduce((a, e) => a + e.kg, 0);
  // Varios tramos suelen compartir el mismo motivo: se muestra una sola vez para no repetir el párrafo.
  const tramosAgrupados = flujo.tramosSinDatos.reduce<Array<{ motivo: string; tramos: string[] }>>((acc, t) => {
    const tramo = `${t.desde} → ${t.hacia}`;
    const existente = acc.find(g => g.motivo === t.motivo);
    return existente ? acc.map(g => (g === existente ? { ...g, tramos: [...g.tramos, tramo] } : g)) : [...acc, { motivo: t.motivo, tramos: [tramo] }];
  }, []);
  return (
    <div className="mt-3 space-y-2 text-xs text-text-secondary">
      {flujo.tramosSinDatos.length > 0 && (
        <div className="flex gap-2 rounded-lg bg-surface-alt p-2.5">
          <Info size={14} className="mt-0.5 shrink-0 text-text-muted" aria-hidden="true" />
          <div>
            <p className="font-medium text-text-primary">Este tramo aún no tiene datos registrados</p>
            <ul className="mt-0.5 space-y-0.5">
              {tramosAgrupados.map(g => <li key={g.motivo}><strong>{g.tramos.join(' · ')}:</strong> {g.motivo}</li>)}
            </ul>
            <p className="mt-1">No se dibuja ningún flujo ahí para no inventar cifras.</p>
          </div>
        </div>
      )}
      {flujo.sinTransformaciones && !flujo.sinDatos && flujo.mensajeSinDatos && (
        <p>{flujo.mensajeSinDatos} <Link to="/transformaciones" className="font-medium text-brand-700 underline underline-offset-2">Registrar transformación →</Link></p>
      )}
      {flujo.categoriasSinTransformaciones.length > 0 && !flujo.sinTransformaciones && (
        <p>Sin transformaciones en el período: {flujo.categoriasSinTransformaciones.map(c => c.nombre).join(', ')}. Su flujo termina en la categoría.</p>
      )}
      {incoherentes.length > 0 && (
        <details>
          <summary className="cursor-pointer font-medium text-amber-800">{incoherentes.length} {incoherentes.length === 1 ? 'tramo' : 'tramos'} ({formatearKg(omitidosKg)}) no se dibujaron por datos incoherentes</summary>
          <ul className="mt-1 list-disc pl-5">{incoherentes.map(e => <li key={`${e.origen}>${e.destino}`}>{e.origen} → {e.destino}: {formatearKg(e.kg)} ({e.motivo})</li>)}</ul>
        </details>
      )}
      {despreciables.length > 0 && (
        <p>{despreciables.length} {despreciables.length === 1 ? 'tramo' : 'tramos'} de menos de 0,5 kg ({formatearKg(despreciablesKg)} en total) no se dibujan, pero sí cuentan en los totales.</p>
      )}
      <p>
        En el período: {formatearKg(flujo.totales.kgComprado)} comprados · {formatearKg(flujo.totales.kgTransformado)} transformados ({flujo.totales.transformaciones}) · {formatearKg(flujo.totales.kgMerma)} de merma · {formatearKg(flujo.totales.kgDespachado)} despachados. Las franjas son proporcionales a los kg.
      </p>
    </div>
  );
}

function FlujoSankey({ filtros }: FlujoSankeyProps) {
  const cambiar = useCambiarFiltros();
  const [comoLista, setComoLista] = useState(false);
  const params = useMemo(() => parametrosPantalla(filtros, { sinCategoria: true }), [filtros]);
  const { dato, error, actualizando, recargar } = useDatosPantalla<FlujoPantalla>(claveParametros(params), () => obtenerFlujoPantalla(params));
  const layout = useMemo(() => {
    if (!dato || dato.sinDatos) return null;
    const ancho = ANCHO - MARGEN_IZQ - MARGEN_DER;
    // Muchas clasificaciones de compra pequeñas se agrupan en un nodo para que la columna sea legible.
    const base = agruparClasificaciones(dato);
    const op = { ancho, altoMinimo: ALTO_MINIMO_NODO };
    // Primera pasada para saber cuántos nodos tiene la columna más poblada; la segunda ajusta el alto a eso.
    const previo = calcularLayoutSankey(base, { ...op, alto: ALTO_MINIMO });
    const porColumna = new Map<number, number>();
    for (const n of previo.nodos) porColumna.set(n.columna, (porColumna.get(n.columna) ?? 0) + 1);
    const alto = Math.max(ALTO_MINIMO, Math.max(0, ...porColumna.values()) * ALTO_POR_NODO);
    return alto === ALTO_MINIMO ? previo : calcularLayoutSankey(base, { ...op, alto });
  }, [dato]);
  const hayDiagrama = Boolean(layout && layout.nodos.length > 0);

  const acciones = hayDiagrama ? (
    <button type="button" onClick={() => setComoLista(v => !v)} aria-pressed={comoLista} className="hidden items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-hover md:flex focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
      {comoLista ? <Workflow size={14} aria-hidden="true" /> : <List size={14} aria-hidden="true" />} {comoLista ? 'Ver diagrama' : 'Ver como lista'}
    </button>
  ) : undefined;

  return (
    <Bloque titulo="Flujo del material" queEstasViendo="de dónde viene el material y en qué se convierte: compra, categoría, lote de trabajo, lote de exportación, venta directa o merma. Haz clic en una franja para filtrar." acciones={acciones}>
      {!dato && !error && <SkeletonBloque alto="h-80" />}
      {error && !dato && <ErrorBloque mensaje={error} onReintentar={recargar} />}
      {dato && (
        <div className={actualizando ? 'opacity-60 transition-opacity' : ''}>
          <AvisosMeta meta={dato} />
          {error && <p role="alert" className="mb-3 text-xs text-red-700">No se pudo actualizar: {error}</p>}
          {filtros.categoria && <div className="mb-2"><ChipFiltro etiqueta={filtros.categoria} onQuitar={() => cambiar({ categoria: undefined })} /></div>}
          {dato.sinDatos || !hayDiagrama ? (
            <EstadoSinDatos mensaje={dato.mensajeSinDatos ?? 'Aún no hay movimientos para dibujar el flujo en este período.'} />
          ) : (
            <>
              <div className="rounded-xl border border-border bg-surface p-3">
                {!comoLista && <Diagrama layout={layout!} categoria={filtros.categoria} onFiltrar={c => cambiar({ categoria: c ?? undefined })} />}
                <ListaFlujo flujo={dato} visibleEnEscritorio={comoLista} />
              </div>
              <Notas flujo={dato} />
            </>
          )}
          {(dato.sinDatos) && dato.tramosSinDatos.length > 0 && <Notas flujo={dato} />}
        </div>
      )}
    </Bloque>
  );
}

export default FlujoSankey;
