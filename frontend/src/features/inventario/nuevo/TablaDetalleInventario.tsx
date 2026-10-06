/** Tabla única de detalle del inventario: una fila por producto o lote con stock, agrupada por vista y categoría, ordenable por
 *  cualquier columna (aria-sort, teclado), con totales, exportación a CSV y composición desplegable de los lotes.
 *  Pide GET /api/inventario/pantalla/detalle con los filtros de la URL (categoría, almacén, q); la etapa se filtra en el cliente.
 *  En móvil las filas se apilan como tarjetas. Columnas: Material | Kg | Etapa | Días| Ubicación. */

import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Download } from 'lucide-react';
import type { DetallePantalla, FilaDetalleInventario } from '@shared/types/inventario-pantalla.js';
import { formatearKg, formatearNumero, type FiltrosPantalla } from '../../../lib/inventario-nuevo';
import { estiloCategoria } from '../../../lib/colores-categoria';
import {
  ETIQUETA_ETAPA, EXPLICACION_ETAPAS_PCB, LIMITE_FILAS_INICIAL, ORDEN_TABLA_POR_DEFECTO, PASOS_LIMITE, agruparFilas, agruparPorVista, alternarOrden, ariaSort,
  COLUMNAS_TABLA, armarCsv, claveParametros, esFilaExpandible, etapaVisible, filtrarPorEtapa, filtrarPorTexto, filtrosComposicion, formatearDiasEstimados, 
  nombreArchivoCsv, parametrosPantalla, textoEnTransformacion, textoUbicacion, textoUbicacionCorta, textoUltimoDespacho, totalizarFilas,
  type ColumnaTabla, type DefColumna, type GrupoTabla, type OrdenTabla, type TotalesFilas,
} from '../../../lib/inventario-pantalla';
import { obtenerDetallePantalla } from '../../../services/inventario-pantalla-service';
import { Bloque, EstadoVacio, InfoTooltip, Insignia, exportarCsv } from '../../../components/ui';
import { AvisosMeta, ChipFiltro, ErrorBloque, EXPLICACION_BASURA, ExplicacionDias, EXPLICACION_LIMPIEZA, SkeletonBloque } from './PantallaComun';
import ComposicionLote from './ComposicionLote';
import { useCambiarFiltros, useDatosPantalla } from './useDatosPantalla';
import { useMediaQuery } from '../../../hooks/use-media-query';

export interface TablaDetalleInventarioProps {
  /** Filtros vigentes de la pantalla (ya validados; vienen de la URL). */
  filtros: FiltrosPantalla;
  /** Sube cuando hay que volver a pedir los datos (por ejemplo, tras marcar kg como embalados). */
  recarga?: number;
}

/** Con más filas que esto, los grupos arrancan cerrados para que la tabla no sea un muro. */
const MAX_FILAS_ABIERTAS_POR_DEFECTO = 40;

/** Ancho desde el cual se usa la tabla (breakpoint md de Tailwind); por debajo, tarjetas. */
const CONSULTA_ESCRITORIO = '(min-width: 768px)';

const AYUDAS: Record<DefColumna['clave'], ReactNode> = {
  material: 'Producto o lote. Debajo, en gris, el último despacho (fecha y kg) y los kg que están en una transformación que aún no termina. Los lotes se pueden desplegar con la flecha para ver los productos de compra que lo forman (el desglose puede cubrir solo una parte del stock del lote).',
  kg: 'Kg que hay hoy de ese producto o lote, sumando todos los almacenes. Es una sola fila por producto: lo despachado o en transformación no suma aquí, se ve debajo del nombre.',
  etapa: EXPLICACION_ETAPAS_PCB,
  dias: <ExplicacionDias />,
  ubicacion: 'Almacén donde está (G1, G2…). Si está repartido en varios, se ve cuántos kg hay en cada uno.',
};

function descargarCsv(filas: FilaDetalleInventario[]) {
  exportarCsv(nombreArchivoCsv(new Date()), armarCsv(filas));
}

function Insignias({ f }: { f: FilaDetalleInventario }) {
  return (
    <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
      {f.fase && <Insignia forma="cuadrada" tono="marca">{f.fase === 'por_procesar' ? 'Por procesar' : 'Ya procesado'}</Insignia>}
      {f.limpieza && (
        <Insignia forma="cuadrada" title={EXPLICACION_LIMPIEZA}>
          {f.limpieza === 'limpio' ? 'Material limpio' : 'Material sucio'} · {f.limpiezaOrigen === 'producto' ? 'según el producto' : 'según el nombre'}
        </Insignia>
      )}
      {f.destinoBasura && (
        <Insignia forma="cuadrada" title={EXPLICACION_BASURA}>
          {f.destinoBasura === 'recuperable' ? 'Basura recuperable' : 'Desecho (no se recupera)'} · según el nombre
        </Insignia>
      )}
      {f.esClasificacionCompra && <Insignia forma="cuadrada" tono="aviso" title="Tipo de tarjeta PCB que solo sirve para registrar la compra. El inventario de PCB se lleva en lotes.">Clasificación de compra</Insignia>}
    </span>
  );
}

/** Líneas pequeñas y grises bajo el nombre: último despacho y kg en transformación (nunca filas aparte). */
function NotasFila({ f }: { f: FilaDetalleInventario }) {
  const despacho = textoUltimoDespacho(f);
  const transf = textoEnTransformacion(f);
  if (!despacho && !transf) return null;
  return (
    <span className="mt-0.5 block text-[11px] font-normal leading-tight text-text-secondary">
      {despacho && <span className="block">{despacho}</span>}
      {transf && <span className="block">{transf}</span>}
    </span>
  );
}

/** Texto del detalle de la antigüedad estimada: de qué entradas sale el promedio y cuántos kg quedaron sin fecha. */
function detalleDias(d: NonNullable<FilaDetalleInventario['dias']>): string {
  const sinFecha = d.kgSinFecha > 0 ? ` Otros ${formatearKg(d.kgSinFecha)} no tienen entrada registrada y no cuentan en el promedio.` : '';
  return `Estimado: promedio de días desde la entrada de ${formatearKg(d.kgConFecha)} (entradas del ${d.fechaEntradaMasAntigua} al ${d.fechaEntradaMasReciente}).${sinFecha}`;
}

function CeldaDias({ f }: { f: FilaDetalleInventario }) {
  return f.dias
    ? <span title={detalleDias(f.dias)}>{formatearDiasEstimados(f.dias.diasPromedio)}</span>
    : <span className="text-text-muted" title="Sin dato: no hay compras, transformaciones ni ajustes registrados que expliquen este stock, así que no se pueden calcular los días.">—</span>;
}

function EncabezadoOrdenable({ columna, orden, onOrdenar }: { columna: DefColumna; orden: OrdenTabla; onOrdenar: (c: ColumnaTabla) => void }) {
  const activo = orden.columna === columna.clave;
  const Icono = !activo ? ArrowUpDown : orden.sentido === 'asc' ? ArrowUp : ArrowDown;
  const ayuda = AYUDAS[columna.clave];
  return (
    <th scope="col" aria-sort={ariaSort(orden, columna.clave)} className={`px-3 py-2 font-medium ${columna.derecha ? 'text-right' : 'text-left'}`}>
      <span className={`inline-flex items-center gap-1 ${columna.derecha ? 'flex-row-reverse' : ''}`}>
        <button
          type="button"
          onClick={() => onOrdenar(columna.clave)}
          className={`inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${activo ? 'text-text-primary' : ''}`}
          title={`Ordenar por ${columna.etiqueta}`}
        >
          {columna.etiqueta}
          <Icono size={12} aria-hidden="true" />
        </button>
        {ayuda && <InfoTooltip etiqueta={`Qué significa: ${columna.etiqueta}`}>{ayuda}</InfoTooltip>}
      </span>
    </th>
  );
}

interface FilaProps {
  f: FilaDetalleInventario;
  columnas: DefColumna[];
  expandida: boolean;
  onExpandir: (id: string) => void;
  filtrosComp: ReturnType<typeof filtrosComposicion>;
  /** Cambia cuando la tabla se recarga: la composición de un lote expandido se vuelve a pedir. */
  version?: number;
}

function BotonExpandir({ f, expandida, onExpandir }: { f: FilaDetalleInventario; expandida: boolean; onExpandir: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onExpandir(f.id)}
      aria-expanded={expandida}
      aria-controls={`composicion-${f.id}`}
      aria-label={`${expandida ? 'Ocultar' : 'Ver'} la composición de ${f.material}`}
      title="Ver los productos de compra que forman este lote"
      className="mr-1 inline-flex items-center rounded p-0.5 align-middle text-text-secondary hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
    >
      {expandida ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
    </button>
  );
}

function CeldaMaterial({ f, expandida, onExpandir }: Pick<FilaProps, 'f' | 'expandida' | 'onExpandir'>) {
  const expandible = esFilaExpandible(f);
  return (
    <>
      {expandible && <BotonExpandir f={f} expandida={expandida} onExpandir={onExpandir} />}
      {f.material}<Insignias f={f} />
      <NotasFila f={f} />
    </>
  );
}

function celda(c: DefColumna['clave'], p: FilaProps) {
  const { f } = p;
  switch (c) {
    case 'material':
      return <td key={c} className={`px-3 py-2 font-medium text-text-primary ${esFilaExpandible(f) ? 'pl-5' : 'pl-9'}`}><CeldaMaterial f={f} expandida={p.expandida} onExpandir={p.onExpandir} /></td>;
    case 'kg':
      return <td key={c} className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{formatearKg(f.kg)}</td>;
    case 'etapa':
      return (
        <td key={c} className="px-3 py-2 text-xs">
          {etapaVisible(f)}
          {f.tipo === 'lote' && f.embaladoKg !== null && f.enSacaKg !== null && (
            <span className="block text-[10px] text-text-secondary"><span className="whitespace-nowrap">{formatearKg(f.embaladoKg)} embalados</span> · <span className="whitespace-nowrap">{formatearKg(f.enSacaKg)} en saca</span></span>
          )}
        </td>
      );
    case 'dias':
      return <td key={c} className="whitespace-nowrap px-3 py-2 text-right tabular-nums"><CeldaDias f={f} /></td>;
    case 'ubicacion':
      return <td key={c} className="whitespace-nowrap px-3 py-2 text-xs text-text-secondary" title={textoUbicacion(f)}>{textoUbicacionCorta(f) || '—'}</td>;
  }
}

function FilaMaterial(p: FilaProps) {
  const { f, columnas, expandida, filtrosComp, version } = p;
  return (
    <>
      <tr className="border-t border-border hover:bg-surface-alt">{columnas.map(c => celda(c.clave, p))}</tr>
      {expandida && esFilaExpandible(f) && (
        <tr className="bg-surface-alt/60">
          <td colSpan={columnas.length} className="px-3 py-3 pl-9">
            <div id={`composicion-${f.id}`}><ComposicionLote loteId={f.loteId!} filtros={filtrosComp} kgLote={f.kg} version={version} /></div>
          </td>
        </tr>
      )}
    </>
  );
}

function TarjetaMovil({ f, expandida, onExpandir, filtrosComp, version }: FilaProps) {
  return (
    <li className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-medium text-text-primary"><CeldaMaterial f={f} expandida={expandida} onExpandir={onExpandir} /></p>
        <p className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-text-primary">{formatearKg(f.kg)}</p>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div><dt className="text-text-secondary">Etapa</dt><dd className="font-medium">{etapaVisible(f)}</dd></div>
        <div><dt className="text-text-secondary">Días (estimado)</dt><dd className="font-medium tabular-nums"><CeldaDias f={f} /></dd></div>
        <div><dt className="text-text-secondary">Ubicación</dt><dd className="font-medium" title={textoUbicacion(f)}>{textoUbicacionCorta(f) || '—'}</dd></div>
      </dl>
      {expandida && esFilaExpandible(f) && <div id={`composicion-${f.id}`} className="mt-3"><ComposicionLote loteId={f.loteId!} filtros={filtrosComp} kgLote={f.kg} version={version} /></div>}
    </li>
  );
}

function EncabezadoGrupo({ g, abierto, onAlternar }: { g: GrupoTabla; abierto: boolean; onAlternar: () => void }) {
  const estilo = estiloCategoria(g.nombre);
  return (
    <button
      type="button"
      onClick={onAlternar}
      aria-expanded={abierto}
      className="flex items-center gap-2 rounded px-1 py-0.5 text-left font-semibold text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
    >
      {abierto ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
      <span aria-hidden="true" style={{ color: estilo.color }}>{estilo.simbolo}</span>
      {g.nombre}
      <span className="text-xs font-normal text-text-secondary">({g.filas.length})</span>
    </button>
  );
}

/** Fila de cabecera de grupo en la tabla: el kg cae en su columna; el resto queda vacío. */
function FilaTotales({ columnas, primera, kg, clase }: { columnas: DefColumna[]; primera: React.ReactNode; kg: number; clase: string }) {
  return (
    <tr className={clase}>
      {columnas.map(c => {
        if (c.clave === 'material') return <td key={c.clave} className="px-3 py-2">{primera}</td>;
        if (c.clave === 'kg') return <td key={c.clave} className="whitespace-nowrap px-3 py-2 text-right text-sm font-semibold tabular-nums">{formatearKg(kg)}</td>;
        return <td key={c.clave} />;
      })}
    </tr>
  );
}

function TablaDetalleInventario({ filtros, recarga = 0 }: TablaDetalleInventarioProps) {
  const cambiar = useCambiarFiltros();
  const [limite, setLimite] = useState<number>(LIMITE_FILAS_INICIAL);
  const [orden, setOrden] = useState<OrdenTabla>(ORDEN_TABLA_POR_DEFECTO);
  const [forzados, setForzados] = useState<Record<string, boolean>>({});
  const [expandidas, setExpandidas] = useState<Record<string, boolean>>({});
  const verClasificaciones = filtros.clasificaciones === '1';
  // Una sola vista montada (tabla en escritorio, tarjetas en móvil): así cada lote expandido pide su composición una vez y los ids no se duplican.
  const esEscritorio = useMediaQuery(CONSULTA_ESCRITORIO);

  const params = useMemo(
    () => parametrosPantalla(filtros, { limite, incluirClasificaciones: verClasificaciones, sinValor: true }),
    [filtros, limite, verClasificaciones],
  );
  const { dato, error, actualizando, recargar } = useDatosPantalla<DetallePantalla>(`${claveParametros(params)}|r${recarga}`, () => obtenerDetallePantalla(params));

  // Mientras llega la respuesta del servidor para una búsqueda nueva, se filtra al instante lo que ya está en pantalla.
  const filas = useMemo(() => {
    const base = dato?.filas ?? [];
    return filtrarPorEtapa(actualizando ? filtrarPorTexto(base, filtros.q) : base, filtros.etapa);
  }, [dato, actualizando, filtros.q, filtros.etapa]);
  const grupos = useMemo(() => agruparFilas(filas, orden), [filas, orden]);
  const vistas = useMemo(() => agruparPorVista(grupos), [grupos]);
  // Totales: los del servidor cubren TODAS las filas (aunque se recorten); si se filtró por etapa se recalculan sobre lo visible.
  const totales = useMemo<TotalesFilas>(() => {
    const t = totalizarFilas(filas);
    if (dato && !filtros.etapa && !actualizando && dato.limite.truncado) {
      return { ...t, kg: dato.totales.kgEnGalpon };
    }
    return t;
  }, [filas, dato, actualizando, filtros.etapa]);

  const abiertoPorDefecto = filas.length <= MAX_FILAS_ABIERTAS_POR_DEFECTO;
  const estaAbierto = (clave: string) => forzados[clave] ?? abiertoPorDefecto;
  const alternarGrupo = (clave: string) => setForzados(prev => ({ ...prev, [clave]: !(prev[clave] ?? abiertoPorDefecto) }));
  const fijarTodos = (abierto: boolean) => setForzados(Object.fromEntries(grupos.map(g => [g.clave, abierto])));
  const alternarExpandida = (id: string) => setExpandidas(prev => ({ ...prev, [id]: !prev[id] }));

  const columnas = COLUMNAS_TABLA;
  const filtrosComp = useMemo(() => filtrosComposicion(filtros), [filtros.desde, filtros.hasta, filtros.almacen]); // eslint-disable-line react-hooks/exhaustive-deps
  const siguienteLimite = PASOS_LIMITE.find(p => p > limite);
  const hayFiltrosTabla = Boolean(filtros.categoria || filtros.q || filtros.almacen || filtros.etapa);

  const acciones = (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={verClasificaciones}
          onChange={e => cambiar({ clasificaciones: e.target.checked ? '1' : undefined })}
          className="h-4 w-4 rounded border-border-strong accent-brand-600"
        />
        Ver clasificaciones de compra PCB
        <InfoTooltip etiqueta="Qué son las clasificaciones de compra PCB">
          Las ~15 clasificaciones de tarjetas (mixto 1, RAM dorada, teléfono...) solo sirven para registrar la compra: toda tarjeta se guarda en un lote de trabajo. Por eso el inventario de PCB son sus lotes. Esta opción muestra además cualquier clasificación que tenga stock sin lote.
        </InfoTooltip>
      </label>
      <button
        type="button"
        disabled={filas.length === 0}
        onClick={() => descargarCsv(filas)}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <Download size={14} aria-hidden="true" /> Exportar CSV
      </button>
    </div>
  );

  return (
    <div id="detalle-inventario">
      <Bloque titulo="Detalle del inventario" queEstasViendo="cada producto y lote con stock hoy: kg, etapa, días en inventario y ubicación, agrupado por vista y categoría. Es una sola fila por producto; el último despacho y lo que está en transformación se ven en gris bajo el nombre. Haz clic en un encabezado para ordenar." acciones={acciones}>
        {!dato && !error && <SkeletonBloque alto="h-64" />}
        {error && !dato && <ErrorBloque mensaje={error} onReintentar={recargar} />}
        {dato && (
          <div className={actualizando ? 'opacity-70 transition-opacity' : ''}>
            <AvisosMeta meta={dato} />
            {error && <p role="alert" className="mb-3 text-xs text-red-700">No se pudo actualizar: {error}</p>}


            {hayFiltrosTabla && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {filtros.categoria && <ChipFiltro etiqueta={filtros.categoria} onQuitar={() => cambiar({ categoria: undefined })} />}
                {filtros.q && <ChipFiltro etiqueta={`«${filtros.q}»`} onQuitar={() => cambiar({ q: undefined })} />}
                {filtros.etapa && <ChipFiltro etiqueta={`etapa ${ETIQUETA_ETAPA[filtros.etapa === 'materia_prima' ? 'recibido' : filtros.etapa]}`} onQuitar={() => cambiar({ etapa: undefined })} />}
                {filtros.almacen && <ChipFiltro etiqueta="un almacén" onQuitar={() => cambiar({ almacen: undefined })} />}
              </div>
            )}

            {filas.length === 0 ? (
              <EstadoVacio
                mensaje={hayFiltrosTabla ? 'Ningún producto ni lote coincide con estos filtros.' : 'Aún no hay inventario para mostrar.'}
                descripcion={filtros.categoria?.toLowerCase() === 'pcb' ? 'El inventario de PCB son sus lotes de trabajo y de exportación. Las clasificaciones de compra solo se ven activando «Ver clasificaciones de compra PCB».' : undefined}
                accion={hayFiltrosTabla
                  ? { etiqueta: 'Quitar estos filtros', onClick: () => cambiar({ categoria: undefined, q: undefined, etapa: undefined, almacen: undefined }) }
                  : { etiqueta: 'Ver almacenes', to: '/inventario-legacy?pestana=almacenes' }}
              />
            ) : (
              <>
                <div className="mb-2 flex gap-3 text-xs">
                  <button type="button" onClick={() => fijarTodos(true)} className="font-medium text-brand-700 underline underline-offset-2">Expandir todo</button>
                  <button type="button" onClick={() => fijarTodos(false)} className="font-medium text-brand-700 underline underline-offset-2">Contraer todo</button>
                </div>

                {/* Escritorio / tablet: tabla con scroll horizontal acotado a su contenedor. */}
                {esEscritorio && (
                <div className="overflow-x-auto rounded-xl border border-border bg-surface">
                  <table className="w-full min-w-[52rem] text-sm">
                    <caption className="sr-only">Detalle del inventario agrupado por vista y categoría</caption>
                    <thead className="bg-surface-alt text-xs text-text-secondary">
                      <tr>{columnas.map(c => <EncabezadoOrdenable key={c.clave} columna={c} orden={orden} onOrdenar={col => setOrden(o => alternarOrden(o, col))} />)}</tr>
                    </thead>
                    {vistas.map(v => (
                      <Fragment key={v.vista}>
                        <tbody>
                          <FilaTotales
                            columnas={columnas}
                            primera={<span className="text-xs font-bold uppercase tracking-wide text-text-primary">{v.etiqueta}</span>}
                            kg={v.totales.kg}
                            clase="border-t-2 border-border-strong bg-brand-50/60"
                          />
                        </tbody>
                        {v.grupos.map(g => {
                          const abierto = estaAbierto(g.clave);
                          return (
                            <tbody key={g.clave}>
                              <FilaTotales
                                columnas={columnas}
                                primera={<EncabezadoGrupo g={g} abierto={abierto} onAlternar={() => alternarGrupo(g.clave)} />}
                                kg={g.totales.kg}
                                clase="border-t border-border-strong bg-surface-alt"
                              />
                              {abierto && g.filas.map(f => (
                                <FilaMaterial key={f.id} f={f} columnas={columnas} expandida={Boolean(expandidas[f.id])} onExpandir={alternarExpandida} filtrosComp={filtrosComp} version={recarga} />
                              ))}
                            </tbody>
                          );
                        })}
                      </Fragment>
                    ))}
                    <tfoot>
                      <FilaTotales
                        columnas={columnas}
                        primera={<span className="font-semibold">Totales ({formatearNumero(totales.filas, 0)} filas)</span>}
                        kg={totales.kg}
                        clase="border-t-2 border-border-strong bg-surface-alt font-semibold"
                      />
                    </tfoot>
                  </table>
                </div>
                )}

                {/* Móvil: tarjetas apiladas por vista y categoría. */}
                {!esEscritorio && (
                <div className="space-y-4">
                  {vistas.map(v => (
                    <div key={v.vista} className="space-y-3">
                      <h3 className="flex items-center justify-between rounded-lg bg-brand-50/60 px-3 py-2 text-xs font-bold uppercase tracking-wide text-text-primary">
                        <span>{v.etiqueta}</span>
                        <span className="tabular-nums">{formatearKg(v.totales.kg)}</span>
                      </h3>
                      {v.grupos.map(g => (
                        <section key={g.clave} aria-label={g.nombre}>
                          <div className="mb-1.5 flex items-center justify-between">
                            <EncabezadoGrupo g={g} abierto={estaAbierto(g.clave)} onAlternar={() => alternarGrupo(g.clave)} />
                            <span className="text-sm font-semibold tabular-nums">{formatearKg(g.totales.kg)}</span>
                          </div>
                          {estaAbierto(g.clave) && (
                            <ul className="space-y-2">
                              {g.filas.map(f => (
                                <TarjetaMovil key={f.id} f={f} columnas={columnas} expandida={Boolean(expandidas[f.id])} onExpandir={alternarExpandida} filtrosComp={filtrosComp} version={recarga} />
                              ))}
                            </ul>
                          )}
                        </section>
                      ))}
                    </div>
                  ))}
                  <div className="rounded-lg bg-surface-alt p-3 text-sm font-semibold">
                    Total en galpón: <span className="tabular-nums">{formatearKg(totales.kg)}</span>
                  </div>
                </div>
                )}
                <div className="mt-2 space-y-1 text-[11px] text-text-secondary">
                  <p>Los días en inventario son un estimado (el «?» del encabezado explica cómo se calcula). Limpio/sucio y recuperable/desecho se toman del producto o se deducen del nombre del material.</p>
                  {dato.totales.kgClasificacionesCompraOcultas > 0 && !verClasificaciones && (
                    <p>
                      Hay {formatearKg(dato.totales.kgClasificacionesCompraOcultas)}
                      {' '}de clasificaciones de compra PCB sin lote que no se listan: explican la diferencia de kg con el KPI. Activa «Ver clasificaciones de compra PCB» para verlas.
                    </p>
                  )}
                  {dato.limite.truncado && (
                    <p className="text-amber-800">
                      Se muestran {formatearNumero(dato.limite.maxFilas, 0)} de {formatearNumero(dato.limite.totalFilas, 0)} filas; los totales cuentan todas.
                      {siguienteLimite
                        ? <> <button type="button" onClick={() => setLimite(siguienteLimite)} className="font-medium underline underline-offset-2">Mostrar hasta {formatearNumero(siguienteLimite, 0)}</button> o afina los filtros.</>
                        : ' Afina los filtros para ver el resto.'}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </Bloque>
    </div>
  );
}

export default TablaDetalleInventario;
