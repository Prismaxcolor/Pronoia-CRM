/** Tabla única de detalle del inventario (Fase 3): agrupada por categoría y expandible, ordenable por cualquier columna
 *  (aria-sort, teclado), con totales, exportación a CSV y toggle de clasificaciones de compra PCB.
 *  Pide GET /api/inventario/pantalla/detalle con los filtros de la URL (categoría, almacén, q); la etapa se filtra en el cliente.
 *  En móvil las filas se apilan como tarjetas. Se carga con React.lazy: export default. */

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Download } from 'lucide-react';
import type { DetallePantalla, FilaDetalleInventario } from '@shared/types/inventario-pantalla.js';
import { formatearCantidadKg, formatearKg, formatearNumero, formatearUsd, type FiltrosPantalla } from '../../../lib/inventario-nuevo';
import { estiloCategoria } from '../../../lib/colores-categoria';
import {
  AVISO_CSV_SIN_VALOR, ETIQUETA_ETAPA, EXPLICACION_ETAPAS_PCB, etapaVisible, LIMITE_FILAS_INICIAL, ORDEN_TABLA_POR_DEFECTO, PASOS_LIMITE, agruparFilas, alternarOrden, ariaSort,
  armarCsv, claveParametros, filtrarPorEtapa, formatearDiasEstimados, formatearUsdKg, nombreArchivoCsv, parametrosPantalla, precioKgFila,
  textoUbicacion, totalizarFilas, usdFila, type ColumnaTabla, type GrupoTabla, type OrdenTabla, type TotalesFilas,
} from '../../../lib/inventario-pantalla';
import { obtenerDetallePantalla } from '../../../services/inventario-pantalla-service';
import type { ResumenInventario } from '../../../services/inventario-resumen-service';
import { Bloque, EstadoVacio, InfoTooltip, Insignia, exportarCsv } from '../../../components/ui';
import { AvisosMeta, ChipFiltro, ErrorBloque, EXPLICACION_BASURA, EXPLICACION_DIAS, EXPLICACION_LIMPIEZA, SinPermiso, SkeletonBloque } from './PantallaComun';
import { useCambiarFiltros, useDatosPantalla } from './useDatosPantalla';

export interface TablaDetalleInventarioProps {
  /** Filtros vigentes de la pantalla (ya validados; vienen de la URL). */
  filtros: FiltrosPantalla;
  /** Resumen cargado (GET /api/inventario/resumen). No se usa: este bloque pide sus propios datos. */
  resumen: ResumenInventario | null;
}

/** Con más filas que esto, los grupos arrancan cerrados para que la tabla no sea un muro. */
const MAX_FILAS_ABIERTAS_POR_DEFECTO = 40;

const COLUMNAS: Array<{ clave: ColumnaTabla; etiqueta: string; derecha?: boolean; ayuda?: string; ocultaSinValor?: boolean }> = [
  { clave: 'material', etiqueta: 'Material' },
  { clave: 'categoria', etiqueta: 'Categoría' },
  { clave: 'etapa', etiqueta: 'Etapa', ayuda: EXPLICACION_ETAPAS_PCB },
  { clave: 'kg', etiqueta: 'Kg', derecha: true },
  { clave: 'precioKg', etiqueta: '$/kg', derecha: true, ocultaSinValor: true, ayuda: 'En materiales es el costo promedio por kg de las compras; en lotes, el precio estimado de venta por kg. Son cifras distintas: no se suman.' },
  { clave: 'usd', etiqueta: 'USD', derecha: true, ocultaSinValor: true, ayuda: 'En materiales es el valor a costo (kg x costo); en lotes, el valor estimado de venta. Nunca se suman entre sí.' },
  { clave: 'dias', etiqueta: 'Días (estim.)', derecha: true, ayuda: EXPLICACION_DIAS },
  { clave: 'ubicacion', etiqueta: 'Ubicación' },
];

function descargarCsv(filas: FilaDetalleInventario[], valorOculto: boolean) {
  exportarCsv(nombreArchivoCsv(new Date()), armarCsv(filas, { valorOculto }));
}

function Insignias({ f }: { f: FilaDetalleInventario }) {
  const base = 'rounded px-1.5 py-0.5 text-[10px] font-medium';
  return (
    <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
      {f.fase && <Insignia forma="cuadrada" tono="marca">{f.fase === 'por_procesar' ? 'Por procesar' : 'Ya procesado'}</Insignia>}
      {f.limpieza && (
        <Insignia forma="cuadrada" title={EXPLICACION_LIMPIEZA}>
          {f.limpieza === 'limpio' ? 'Limpio' : 'Sucio'} ({f.limpiezaOrigen === 'producto' ? 'del producto' : 'del nombre'})
        </Insignia>
      )}
      {f.destinoBasura && (
        <Insignia forma="cuadrada" title={EXPLICACION_BASURA}>
          {f.destinoBasura === 'recuperable' ? 'Recuperable' : 'Desecho'} (del nombre)
        </Insignia>
      )}
      {f.esClasificacionCompra && <Insignia forma="cuadrada" tono="aviso">Clasificación de compra</Insignia>}
      {!f.enGalpon && <span className={`${base} bg-surface-hover text-text-secondary`}>{f.etapa === 'despachado' ? 'Despachado (ya salió)' : 'En transformación (fuera del galpón)'}</span>}
    </span>
  );
}

function CeldaUsd({ f, valorOculto }: { f: FilaDetalleInventario; valorOculto: boolean }) {
  if (valorOculto) return <SinPermiso corto />;
  const v = usdFila(f);
  if (v === null) return <span className="text-text-muted">—</span>;
  return (
    <span>
      {formatearUsd(v)}
      <span className="block text-[10px] font-normal text-text-secondary">{f.tipo === 'lote' ? 'venta estimada' : 'costo'}</span>
    </span>
  );
}

function CeldaPrecio({ f, valorOculto }: { f: FilaDetalleInventario; valorOculto: boolean }) {
  if (valorOculto) return <SinPermiso corto />;
  const v = precioKgFila(f);
  return v === null ? <span className="text-text-muted">—</span> : <span>{formatearUsdKg(v)}</span>;
}

function CeldaDias({ f }: { f: FilaDetalleInventario }) {
  return f.dias ? <span>{formatearDiasEstimados(f.dias.diasPromedio)}</span> : <span className="text-text-muted" title="Sin entradas registradas que expliquen este stock">—</span>;
}

function EncabezadoOrdenable({ columna, orden, valorOculto, onOrdenar }: { columna: (typeof COLUMNAS)[number]; orden: OrdenTabla; valorOculto: boolean; onOrdenar: (c: ColumnaTabla) => void }) {
  const activo = orden.columna === columna.clave;
  const Icono = !activo ? ArrowUpDown : orden.sentido === 'asc' ? ArrowUp : ArrowDown;
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
          {columna.ocultaSinValor && valorOculto && <span className="text-[10px] font-normal">(sin permiso)</span>}
          <Icono size={12} aria-hidden="true" />
        </button>
        {columna.ayuda && <InfoTooltip etiqueta={`Qué significa: ${columna.etiqueta}`}>{columna.ayuda}</InfoTooltip>}
      </span>
    </th>
  );
}

function TextoTotalesValor({ t, valorOculto }: { t: TotalesFilas; valorOculto: boolean }) {
  if (valorOculto) return <SinPermiso corto />;
  if (t.valorCostoUsd === null && t.valorEstimadoUsd === null) return <span className="text-text-muted">—</span>;
  return (
    <span>
      {t.valorCostoUsd !== null && <span className="block">{formatearUsd(t.valorCostoUsd)} <span className="text-[10px] font-normal text-text-secondary">costo</span></span>}
      {t.valorEstimadoUsd !== null && <span className="block">{formatearUsd(t.valorEstimadoUsd)} <span className="text-[10px] font-normal text-text-secondary">venta est.</span></span>}
    </span>
  );
}

function FilaMaterial({ f, valorOculto }: { f: FilaDetalleInventario; valorOculto: boolean }) {
  const estilo = estiloCategoria(f.categoria);
  return (
    <tr className={`border-t border-border hover:bg-surface-alt ${f.enGalpon ? '' : 'text-text-secondary italic'}`}>
      <td className="px-3 py-2 pl-9 font-medium text-text-primary">{f.material}<Insignias f={f} /></td>
      <td className="px-3 py-2 text-xs text-text-secondary"><span aria-hidden="true" style={{ color: estilo.color }}>{estilo.simbolo}</span> {f.categoria}</td>
      <td className="px-3 py-2 text-xs">
        {etapaVisible(f)}
        {f.tipo === 'lote' && f.embaladoKg !== null && f.enSacaKg !== null && (
          <span className="block text-[10px] text-text-secondary"><span className="whitespace-nowrap">{formatearCantidadKg(f.embaladoKg)} embalados</span> · <span className="whitespace-nowrap">{formatearCantidadKg(f.enSacaKg)} en saca</span></span>
        )}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">{formatearKg(f.kg)}</td>
      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums"><CeldaPrecio f={f} valorOculto={valorOculto} /></td>
      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums"><CeldaUsd f={f} valorOculto={valorOculto} /></td>
      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums"><CeldaDias f={f} /></td>
      <td className="px-3 py-2 text-xs text-text-secondary">
        {f.porAlmacen.length === 0 ? '—' : f.porAlmacen.map(a => (
          <span key={a.almacenId} className="block whitespace-nowrap tabular-nums">{a.almacenNombre} {formatearCantidadKg(a.kg)} kg</span>
        ))}
      </td>
    </tr>
  );
}

function TarjetaMovil({ f, valorOculto }: { f: FilaDetalleInventario; valorOculto: boolean }) {
  return (
    <li className={`rounded-lg border border-border bg-surface p-3 ${f.enGalpon ? '' : 'italic'}`}>
      <p className="text-sm font-medium text-text-primary">{f.material}<Insignias f={f} /></p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div><dt className="text-text-secondary">Etapa</dt><dd className="font-medium">{etapaVisible(f)}</dd></div>
        <div><dt className="text-text-secondary">Kg</dt><dd className="font-medium tabular-nums">{formatearKg(f.kg)}</dd></div>
        <div><dt className="text-text-secondary">{f.tipo === 'lote' ? 'Precio est. $/kg' : 'Costo $/kg'}</dt><dd className="font-medium tabular-nums"><CeldaPrecio f={f} valorOculto={valorOculto} /></dd></div>
        <div><dt className="text-text-secondary">USD</dt><dd className="font-medium tabular-nums"><CeldaUsd f={f} valorOculto={valorOculto} /></dd></div>
        <div><dt className="text-text-secondary">Días (estimado)</dt><dd className="font-medium tabular-nums"><CeldaDias f={f} /></dd></div>
        <div><dt className="text-text-secondary">Ubicación</dt><dd className="font-medium">{textoUbicacion(f) || '—'}</dd></div>
      </dl>
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

function CuerpoTabla({ grupos, abiertos, valorOculto, onAlternar }: { grupos: GrupoTabla[]; abiertos: (k: string) => boolean; valorOculto: boolean; onAlternar: (k: string) => void }) {
  return (
    <>
      {grupos.map(g => {
        const abierto = abiertos(g.clave);
        return (
          <tbody key={g.clave}>
            <tr className="border-t border-border-strong bg-surface-alt">
              <td className="px-3 py-2" colSpan={3}><EncabezadoGrupo g={g} abierto={abierto} onAlternar={() => onAlternar(g.clave)} /></td>
              <td className="whitespace-nowrap px-3 py-2 text-right text-sm font-semibold tabular-nums">{formatearKg(g.totales.kgEnGalpon)}</td>
              <td />
              <td className="whitespace-nowrap px-3 py-2 text-right text-sm font-semibold tabular-nums"><TextoTotalesValor t={g.totales} valorOculto={valorOculto} /></td>
              <td colSpan={2} />
            </tr>
            {abierto && g.filas.map(f => <FilaMaterial key={f.id} f={f} valorOculto={valorOculto} />)}
          </tbody>
        );
      })}
    </>
  );
}

function TablaDetalleInventario({ filtros }: TablaDetalleInventarioProps) {
  const cambiar = useCambiarFiltros();
  const [limite, setLimite] = useState<number>(LIMITE_FILAS_INICIAL);
  const [orden, setOrden] = useState<OrdenTabla>(ORDEN_TABLA_POR_DEFECTO);
  const [forzados, setForzados] = useState<Record<string, boolean>>({});
  const verClasificaciones = filtros.clasificaciones === '1';

  const params = useMemo(
    () => parametrosPantalla(filtros, { limite, incluirClasificaciones: verClasificaciones }),
    [filtros, limite, verClasificaciones],
  );
  const { dato, error, actualizando, recargar } = useDatosPantalla<DetallePantalla>(claveParametros(params), () => obtenerDetallePantalla(params));

  const filas = useMemo(() => filtrarPorEtapa(dato?.filas ?? [], filtros.etapa), [dato, filtros.etapa]);
  const grupos = useMemo(() => agruparFilas(filas, orden), [filas, orden]);
  // Totales: los del servidor cubren TODAS las filas (aunque se recorten); si se filtró por etapa se recalculan sobre lo visible.
  const totales = useMemo<TotalesFilas>(() => {
    const t = totalizarFilas(filas);
    if (dato && !filtros.etapa && dato.limite.truncado) {
      return { ...t, kgEnGalpon: dato.totales.kgEnGalpon, kgEnTransformacion: dato.totales.kgEnTransformacion, kgDespachado: dato.totales.kgDespachado, valorCostoUsd: dato.totales.valorCostoUsd, valorEstimadoUsd: dato.totales.valorEstimadoUsd };
    }
    return t;
  }, [filas, dato, filtros.etapa]);

  const abiertoPorDefecto = filas.length <= MAX_FILAS_ABIERTAS_POR_DEFECTO;
  const estaAbierto = (clave: string) => forzados[clave] ?? abiertoPorDefecto;
  const alternarGrupo = (clave: string) => setForzados(prev => ({ ...prev, [clave]: !(prev[clave] ?? abiertoPorDefecto) }));
  const fijarTodos = (abierto: boolean) => setForzados(Object.fromEntries(grupos.map(g => [g.clave, abierto])));

  const valorOculto = dato?.valorOculto ?? false;
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
          Las ~15 clasificaciones de tarjetas (mixto 1, RAM dorada, teléfono...) solo sirven para comprar: toda tarjeta se guarda en un lote de trabajo. Por eso el inventario de PCB son sus lotes. Esta opción muestra además cualquier clasificación que tenga stock sin lote.
        </InfoTooltip>
      </label>
      <button
        type="button"
        disabled={filas.length === 0}
        onClick={() => descargarCsv(filas, valorOculto)}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <Download size={14} aria-hidden="true" /> Exportar CSV
      </button>
    </div>
  );

  return (
    <div id="detalle-inventario">
      <Bloque titulo="Detalle del inventario" queEstasViendo="cada material y lote con su stock, etapa, costo y ubicación, agrupado por categoría. Haz clic en un encabezado para ordenar." acciones={acciones}>
        {!dato && !error && <SkeletonBloque alto="h-64" />}
        {error && !dato && <ErrorBloque mensaje={error} onReintentar={recargar} />}
        {dato && (
          <div className={actualizando ? 'opacity-60 transition-opacity' : ''}>
            <AvisosMeta meta={dato} />
            {error && <p role="alert" className="mb-3 text-xs text-red-700">No se pudo actualizar: {error}</p>}
            {valorOculto && <p className="mb-3 text-xs text-text-secondary">Tu usuario no tiene permiso para ver valores: se ocultan $/kg y USD. {AVISO_CSV_SIN_VALOR}</p>}

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
                mensaje={hayFiltrosTabla ? 'Ningún material ni lote coincide con estos filtros.' : 'Aún no hay inventario para mostrar.'}
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
                <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface md:block">
                  <table className="w-full min-w-[56rem] text-sm">
                    <caption className="sr-only">Detalle del inventario agrupado por categoría</caption>
                    <thead className="bg-surface-alt text-xs text-text-secondary">
                      <tr>{COLUMNAS.map(c => <EncabezadoOrdenable key={c.clave} columna={c} orden={orden} valorOculto={valorOculto} onOrdenar={col => setOrden(o => alternarOrden(o, col))} />)}</tr>
                    </thead>
                    <CuerpoTabla grupos={grupos} abiertos={estaAbierto} valorOculto={valorOculto} onAlternar={alternarGrupo} />
                    <tfoot>
                      <tr className="border-t-2 border-border-strong bg-surface-alt font-semibold">
                        <td className="px-3 py-2.5" colSpan={3}>Totales ({formatearNumero(totales.filas, 0)} filas)</td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-right tabular-nums">{formatearKg(totales.kgEnGalpon)}</td>
                        <td />
                        <td className="px-3 py-2.5 whitespace-nowrap text-right tabular-nums"><TextoTotalesValor t={totales} valorOculto={valorOculto} /></td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Móvil: tarjetas apiladas por categoría. */}
                <div className="space-y-4 md:hidden">
                  {grupos.map(g => (
                    <section key={g.clave} aria-label={g.nombre}>
                      <div className="mb-1.5 flex items-center justify-between">
                        <EncabezadoGrupo g={g} abierto={estaAbierto(g.clave)} onAlternar={() => alternarGrupo(g.clave)} />
                        <span className="text-sm font-semibold tabular-nums">{formatearKg(g.totales.kgEnGalpon)}</span>
                      </div>
                      {estaAbierto(g.clave) && <ul className="space-y-2">{g.filas.map(f => <TarjetaMovil key={f.id} f={f} valorOculto={valorOculto} />)}</ul>}
                    </section>
                  ))}
                  <div className="rounded-lg bg-surface-alt p-3 text-sm font-semibold">
                    Total en galpón: <span className="tabular-nums">{formatearKg(totales.kgEnGalpon)}</span>
                    <div className="mt-0.5 text-xs font-normal"><TextoTotalesValor t={totales} valorOculto={valorOculto} /></div>
                  </div>
                </div>

                <div className="mt-2 space-y-1 text-[11px] text-text-secondary">
                  <p>Los $/kg y USD de materiales son a costo; los de lotes, a precio estimado de venta (no se suman). Los días en inventario son estimados. Limpio/sucio y recuperable/desecho se toman del producto o se deducen del nombre del material.</p>
                  {(totales.kgEnTransformacion > 0 || totales.kgDespachado > 0) && (
                    <p>Fuera del galpón (no suman al total): {formatearKg(totales.kgEnTransformacion)} en transformación y {formatearKg(totales.kgDespachado)} despachados en el período.</p>
                  )}
                  {dato.totales.kgClasificacionesCompraOcultas > 0 && !verClasificaciones && (
                    <p>
                      Hay {formatearKg(dato.totales.kgClasificacionesCompraOcultas)}
                      {!valorOculto && dato.totales.valorClasificacionesCompraOcultasUsd != null && dato.totales.valorClasificacionesCompraOcultasUsd > 0 && <> ({formatearUsd(dato.totales.valorClasificacionesCompraOcultasUsd)} a costo)</>}
                      {' '}de clasificaciones de compra PCB sin lote que no se listan: explican la diferencia de kg
                      {!valorOculto && dato.totales.valorClasificacionesCompraOcultasUsd != null && dato.totales.valorClasificacionesCompraOcultasUsd > 0 && ' y de USD'} con el KPI. Activa «Ver clasificaciones de compra PCB» para verlas.
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
