import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { construirCsv, exportarCsv, nombreArchivoCsv } from '../../lib/csv';
import { formatearNumero } from '../../lib/formato';
import {
  SIN_ORDEN, agruparFilas, alternarOrden, ariaSort, columnasParaCsv, ordenarFilas, ordenarGrupos, paginar, valorATexto,
  type ColumnaTabla, type DefinicionGrupo, type OrdenTabla,
} from '../../lib/tabla-datos';
import EstadoVacio, { type EstadoVacioProps } from './EstadoVacio';
import InfoTooltip from './InfoTooltip';
import { SkeletonTabla } from './Skeletons';

/** CUÁNDO USARLA: cualquier listado con varias columnas (facturas, movimientos, inventario). Trae de serie: orden por
 *  columna (aria-sort y teclado), agrupación opcional expandible, fila de totales, paginación opcional, selección de filas,
 *  exportar a CSV (BOM + escape seguro), estado vacío/cargando y, en móvil, filas apiladas como tarjetas.
 *  Las columnas se declaran tipadas (ColumnaTabla<T>). Para tablas MUY a medida (totales del servidor, filas recortadas)
 *  úsala de referencia, no obligatoriamente. */

export interface AgruparTabla<T> extends DefinicionGrupo<T> {
  /** Con más filas que esto los grupos arrancan cerrados (por defecto 40). */
  maxFilasAbiertasPorDefecto?: number;
}

export interface SeleccionTabla {
  seleccionadas: ReadonlySet<string>;
  onCambiar: (seleccionadas: Set<string>) => void;
}

export interface TablaDatosProps<T> {
  columnas: ReadonlyArray<ColumnaTabla<T>>;
  filas: readonly T[];
  claveFila: (fila: T) => string;
  /** Rótulo para lectores de pantalla (caption) y para nombrar la tabla. */
  titulo: string;
  cargando?: boolean;
  /** Personaliza el estado vacío (mensaje, descripción, acción con enlace). */
  vacio?: Pick<EstadoVacioProps, 'mensaje' | 'descripcion' | 'accion' | 'icono'>;
  ordenInicial?: OrdenTabla;
  onOrdenar?: (orden: OrdenTabla) => void;
  agrupar?: AgruparTabla<T>;
  /** Fila de totales con la suma de cada columna que declare `total`. `true` o etiqueta personalizada. */
  totales?: boolean | { etiqueta?: string };
  paginacion?: { tamano: number };
  seleccion?: SeleccionTabla;
  etiquetaFila?: (fila: T) => string;
  /** Muestra el botón "Exportar CSV" (exporta TODAS las filas, ordenadas, no solo la página). */
  exportar?: { nombreArchivo: string; etiqueta?: string };
  /** Botones extra junto a "Exportar CSV". */
  acciones?: ReactNode;
  /** Render propio de la tarjeta móvil (por defecto: primera columna como título + pares etiqueta/valor). */
  tarjetaMovil?: (fila: T) => ReactNode;
  claseFila?: (fila: T) => string;
  /** Clase de ancho mínimo de la tabla en escritorio (por defecto min-w-[40rem]). */
  anchoMinimo?: string;
}

const MAX_ABIERTAS = 40;

function EncabezadoColumna<T>({ c, orden, onOrdenar }: { c: ColumnaTabla<T>; orden: OrdenTabla; onOrdenar: (clave: string) => void }) {
  const derecha = c.alinear === 'derecha';
  const activo = orden.columna === c.clave;
  const Icono = !activo ? ArrowUpDown : orden.sentido === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={c.valorOrden ? ariaSort(orden, c.clave) : undefined} className={`px-3 py-2 font-medium ${derecha ? 'text-right' : 'text-left'}`}>
      <span className={`inline-flex items-center gap-1 ${derecha ? 'flex-row-reverse' : ''}`}>
        {c.valorOrden ? (
          <button
            type="button"
            onClick={() => onOrdenar(c.clave)}
            title={`Ordenar por ${c.titulo}`}
            className={`inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${activo ? 'text-text-primary' : ''}`}
          >
            {c.titulo}<Icono size={12} aria-hidden="true" />
          </button>
        ) : c.titulo}
        {c.ayuda && <InfoTooltip etiqueta={`Qué significa: ${c.titulo}`}>{c.ayuda}</InfoTooltip>}
      </span>
    </th>
  );
}

function Casilla({ marcada, etiqueta, onCambiar }: { marcada: boolean; etiqueta: string; onCambiar: (m: boolean) => void }) {
  return <input type="checkbox" checked={marcada} aria-label={etiqueta} onChange={e => onCambiar(e.target.checked)} className="h-4 w-4 rounded border-border-strong accent-brand-600" />;
}

function TablaDatos<T>(props: TablaDatosProps<T>) {
  const { columnas, filas, claveFila, titulo, cargando, vacio, agrupar, totales, paginacion, seleccion, exportar, acciones, tarjetaMovil, claseFila, etiquetaFila } = props;
  const [orden, setOrden] = useState<OrdenTabla>(props.ordenInicial ?? SIN_ORDEN);
  const [pagina, setPagina] = useState(1);
  const [forzados, setForzados] = useState<Record<string, boolean>>({});

  // 1) orden (global o dentro de cada grupo), 2) página, 3) grupos de la página.
  const ordenadas = useMemo(() => {
    if (!agrupar) return ordenarFilas(filas, orden, columnas);
    return ordenarGrupos(agruparFilas(filas, agrupar), orden, columnas, agrupar.ordenGrupos).flatMap(g => g.filas);
  }, [filas, orden, columnas, agrupar]);
  const pag = useMemo(() => (paginacion ? paginar(ordenadas, pagina, paginacion.tamano) : null), [ordenadas, paginacion, pagina]);
  const visibles = pag ? pag.filas : ordenadas;
  const grupos = useMemo(() => (agrupar ? agruparFilas(visibles, agrupar) : null), [visibles, agrupar]);

  const abiertoPorDefecto = filas.length <= (agrupar?.maxFilasAbiertasPorDefecto ?? MAX_ABIERTAS);
  const estaAbierto = (clave: string) => forzados[clave] ?? abiertoPorDefecto;
  const alternarGrupo = (clave: string) => setForzados(p => ({ ...p, [clave]: !(p[clave] ?? abiertoPorDefecto) }));
  const fijarTodos = (abierto: boolean) => setForzados(Object.fromEntries((grupos ?? []).map(g => [g.clave, abierto])));

  const cambiarOrden = (clave: string) => {
    const nuevo = alternarOrden(orden, clave);
    setOrden(nuevo);
    setPagina(1);
    props.onOrdenar?.(nuevo);
  };

  const nombreFila = (f: T) => etiquetaFila?.(f) ?? claveFila(f);
  const alternarSeleccion = (clave: string, marcada: boolean) => {
    if (!seleccion) return;
    const s = new Set(seleccion.seleccionadas);
    if (marcada) s.add(clave); else s.delete(clave);
    seleccion.onCambiar(s);
  };
  const todasMarcadas = visibles.length > 0 && visibles.every(f => seleccion?.seleccionadas.has(claveFila(f)));
  const marcarPagina = (marcada: boolean) => {
    if (!seleccion) return;
    const s = new Set(seleccion.seleccionadas);
    for (const f of visibles) { if (marcada) s.add(claveFila(f)); else s.delete(claveFila(f)); }
    seleccion.onCambiar(s);
  };

  const descargar = () => {
    if (!exportar) return;
    exportarCsv(nombreArchivoCsv(exportar.nombreArchivo, new Date()), construirCsv(columnasParaCsv(columnas), ordenadas));
  };

  if (cargando) return <SkeletonTabla columnas={Math.min(columnas.length, 5)} />;
  if (filas.length === 0) {
    return <EstadoVacio mensaje={vacio?.mensaje ?? 'No hay datos para mostrar.'} descripcion={vacio?.descripcion} accion={vacio?.accion} icono={vacio?.icono} />;
  }

  const hayTotales = Boolean(totales) && columnas.some(c => c.total);
  const primeraTotal = Math.max(1, columnas.findIndex(c => c.total));
  const spanEtiqueta = primeraTotal + (seleccion ? 1 : 0);
  const celdaClase = (c: ColumnaTabla<T>) => `px-3 py-2 ${c.alinear === 'derecha' ? 'whitespace-nowrap text-right tabular-nums' : ''} ${c.claseCelda ?? ''}`;
  const contenido = (c: ColumnaTabla<T>, f: T): ReactNode => {
    const v = c.celda ? c.celda(f) : c.valorOrden?.(f);
    return (v !== null && typeof v === 'object' && !(v instanceof Date)) ? (v as ReactNode) : valorATexto(v);
  };
  const celdaTotal = (c: ColumnaTabla<T>, lista: readonly T[]): ReactNode => {
    if (!c.total) return null;
    const v = c.total(lista);
    return (v !== null && typeof v === 'object') ? (v as ReactNode) : valorATexto(v);
  };
  const etiquetaTotales = typeof totales === 'object' && totales.etiqueta ? totales.etiqueta : `Totales (${formatearNumero(filas.length, 0)} filas)`;

  const filaDatos = (f: T, sangria: boolean) => {
    const clave = claveFila(f);
    const marcada = seleccion?.seleccionadas.has(clave) ?? false;
    return (
      <tr key={clave} className={`border-t border-border hover:bg-surface-alt ${marcada ? 'bg-brand-50/60' : ''} ${claseFila?.(f) ?? ''}`}>
        {seleccion && <td className="w-10 px-3 py-2"><Casilla marcada={marcada} etiqueta={`Seleccionar ${nombreFila(f)}`} onCambiar={m => alternarSeleccion(clave, m)} /></td>}
        {columnas.map((c, i) => <td key={c.clave} className={`${celdaClase(c)} ${sangria && i === 0 ? 'pl-9 font-medium text-text-primary' : ''}`}>{contenido(c, f)}</td>)}
      </tr>
    );
  };

  const encabezadoGrupo = (g: { clave: string; titulo: string; filas: T[] }) => (
    <button
      type="button"
      onClick={() => alternarGrupo(g.clave)}
      aria-expanded={estaAbierto(g.clave)}
      className="flex items-center gap-2 rounded px-1 py-0.5 text-left font-semibold text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
    >
      {estaAbierto(g.clave) ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
      {g.titulo}
      <span className="text-xs font-normal text-text-secondary">({g.filas.length})</span>
    </button>
  );

  const tarjeta = (f: T) => (
    <li key={claveFila(f)} className={`rounded-lg border border-border bg-surface p-3 ${claseFila?.(f) ?? ''}`}>
      {tarjetaMovil ? tarjetaMovil(f) : (
        <>
          <div className="flex items-start gap-2">
            {seleccion && <Casilla marcada={seleccion.seleccionadas.has(claveFila(f))} etiqueta={`Seleccionar ${nombreFila(f)}`} onCambiar={m => alternarSeleccion(claveFila(f), m)} />}
            <p className="text-sm font-medium text-text-primary">{contenido(columnas[0], f)}</p>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            {columnas.slice(1).filter(c => !c.ocultaEnMovil).map(c => (
              <div key={c.clave}><dt className="text-text-secondary">{c.titulo}</dt><dd className="font-medium tabular-nums">{contenido(c, f)}</dd></div>
            ))}
          </dl>
        </>
      )}
    </li>
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-3 text-xs">
          {grupos && (
            <>
              <button type="button" onClick={() => fijarTodos(true)} className="font-medium text-brand-700 underline underline-offset-2">Expandir todo</button>
              <button type="button" onClick={() => fijarTodos(false)} className="font-medium text-brand-700 underline underline-offset-2">Contraer todo</button>
            </>
          )}
        </div>
        {(exportar || acciones) && (
          <div className="flex flex-wrap items-center gap-3">
            {acciones}
            {exportar && (
              <button
                type="button"
                onClick={descargar}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                <Download size={14} aria-hidden="true" /> {exportar.etiqueta ?? 'Exportar CSV'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Escritorio / tablet: tabla con scroll horizontal acotado a su contenedor. */}
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface md:block">
        <table className={`w-full ${props.anchoMinimo ?? 'min-w-[40rem]'} text-sm`}>
          <caption className="sr-only">{titulo}</caption>
          <thead className="bg-surface-alt text-xs text-text-secondary">
            <tr>
              {seleccion && <th scope="col" className="w-10 px-3 py-2"><Casilla marcada={todasMarcadas} etiqueta="Seleccionar todas las filas visibles" onCambiar={marcarPagina} /></th>}
              {columnas.map(c => <EncabezadoColumna key={c.clave} c={c} orden={orden} onOrdenar={cambiarOrden} />)}
            </tr>
          </thead>
          {grupos ? grupos.map(g => (
            <tbody key={g.clave}>
              <tr className="border-t border-border-strong bg-surface-alt">
                <td className="px-3 py-2" colSpan={spanEtiqueta}>{encabezadoGrupo(g)}</td>
                {columnas.slice(primeraTotal).map(c => <td key={c.clave} className={`px-3 py-2 text-sm font-semibold ${c.alinear === 'derecha' ? 'whitespace-nowrap text-right tabular-nums' : ''}`}>{celdaTotal(c, g.filas)}</td>)}
              </tr>
              {estaAbierto(g.clave) && g.filas.map(f => filaDatos(f, true))}
            </tbody>
          )) : <tbody>{visibles.map(f => filaDatos(f, false))}</tbody>}
          {hayTotales && (
            <tfoot>
              <tr className="border-t-2 border-border-strong bg-surface-alt font-semibold">
                <td className="px-3 py-2.5" colSpan={spanEtiqueta}>{etiquetaTotales}</td>
                {columnas.slice(primeraTotal).map(c => <td key={c.clave} className={`px-3 py-2.5 ${c.alinear === 'derecha' ? 'whitespace-nowrap text-right tabular-nums' : ''}`}>{celdaTotal(c, ordenadas)}</td>)}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Móvil: tarjetas apiladas (por grupo si hay agrupación). */}
      <div className="space-y-4 md:hidden">
        {grupos ? grupos.map(g => (
          <section key={g.clave} aria-label={g.titulo}>
            <div className="mb-1.5">{encabezadoGrupo(g)}</div>
            {estaAbierto(g.clave) && <ul className="space-y-2">{g.filas.map(tarjeta)}</ul>}
          </section>
        )) : <ul className="space-y-2">{visibles.map(tarjeta)}</ul>}
        {hayTotales && (
          <div className="rounded-lg bg-surface-alt p-3 text-sm font-semibold">
            {etiquetaTotales}
            <dl className="mt-1 grid grid-cols-2 gap-x-3 text-xs font-normal">
              {columnas.filter(c => c.total).map(c => <div key={c.clave}><dt className="text-text-secondary">{c.titulo}</dt><dd className="font-semibold tabular-nums">{celdaTotal(c, ordenadas)}</dd></div>)}
            </dl>
          </div>
        )}
      </div>

      {pag && pag.paginas > 1 && (
        <nav aria-label="Paginación" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
          <span>Mostrando {formatearNumero(pag.desde, 0)}–{formatearNumero(pag.hasta, 0)} de {formatearNumero(pag.total, 0)}</span>
          <span className="flex items-center gap-1">
            <button type="button" disabled={pag.pagina <= 1} onClick={() => setPagina(pag.pagina - 1)} aria-label="Página anterior" className="rounded-lg border border-border bg-surface p-1.5 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            <span className="px-2 tabular-nums">Página {pag.pagina} de {pag.paginas}</span>
            <button type="button" disabled={pag.pagina >= pag.paginas} onClick={() => setPagina(pag.pagina + 1)} aria-label="Página siguiente" className="rounded-lg border border-border bg-surface p-1.5 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </span>
        </nav>
      )}
    </div>
  );
}

export default TablaDatos;
